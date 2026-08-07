#!/usr/bin/env node
/**
 * The "Other" queue, and who can see it.
 *
 *   npm run seed:other-application            # dry run
 *   npm run seed:other-application -- --apply # write
 *
 * DRY RUN BY DEFAULT and idempotent: a re-run reports everything already present.
 *
 * WHY AN APPLICATION AND NOT A FLAG. A requester filing a report request has to
 * say whose data it is about, and sometimes the honest answer is "it spans both"
 * or "I do not know" — but the request still has to land somewhere an analyst will
 * look. Making that somewhere a real application row buys the whole existing
 * machinery for free: it is a queue with grants, it appears in the queue's
 * application filter, and the REDIRECT dialog already moves a ticket from one
 * application to another and writes the hand-off into `submission_routings`. So an
 * analyst picks it up, sees which system it is really about, and routes it — with
 * a trail.
 *
 * The alternative was leaving `application_id` null, which the portal already has
 * a name for ("No application set"). It is the wrong home: only a SUPER USER can
 * see those rows, so a request nobody had claimed would be visible to nobody who
 * works the queue.
 *
 * WHO GETS A GRANT ON IT, AND FOR WHICH TYPES. Everybody who works any queue
 * anywhere, for the types they actually work — DERIVED from the grants that exist
 * rather than a list typed in here, so it stays right as people come and go.
 * Somebody holding an all-types grant ('') anywhere gets '' on Other, because that
 * is the same statement; everybody else gets one row per narrowed type, so an
 * analyst still sees only report requests here.
 *
 * IT USED TO BE `report` ONLY, and that was right while Other was only reachable by
 * a report request. The submit form now asks which application on every branch and
 * offers Other on all of them, so a defect can land here — and with nobody holding
 * a defect grant it would be visible to nobody but a super user. **That is the exact
 * failure this application was invented to avoid**, so the grant follows the door.
 *
 * Re-run it after granting somebody new: it adds the missing rows and nothing else.
 */
require('dotenv').config();
const dbApi = require('../db');

const APPLY = process.argv.includes('--apply');
const OTHER = 'Other';

async function main() {
  await dbApi.init();
  const models = dbApi.getModels() || {};
  const { Application, User, UserApplicationRole } = models;
  if (!Application || !User || !UserApplicationRole) {
    throw new Error('Application, User or UserApplicationRole model is not initialized');
  }

  // Printed first, always: dotenv resolves `.env` from the CWD, so running this
  // from the repo root silently targets the local sql.js file instead of the
  // hosted database. Run it from `server/`.
  const dialect = Application.sequelize.getDialect();
  const applications = await Application.findAll({
    attributes: ['id', 'name', 'sort_order', 'is_active'],
    order: [['sort_order', 'ASC'], ['id', 'ASC']],
    raw: true,
  });
  console.log(`${dialect} · ${applications.length} applications before: ${applications.map((row) => row.name).join(', ')}`);

  let other = applications.find((row) => String(row.name).trim().toLowerCase() === OTHER.toLowerCase());
  const nextOrder = applications.reduce((max, row) => Math.max(max, Number(row.sort_order || 0)), 0) + 1;

  if (other) {
    console.log(`  "${OTHER}" already exists (#${other.id}, ${other.is_active ? 'active' : 'INACTIVE'})`);
  } else if (APPLY) {
    // Last in the list on purpose: it is the answer you reach for when none of the
    // real ones fit, so it should not sit above them.
    other = (await Application.create({
      name: OTHER, sort_order: nextOrder, is_active: 1,
    })).toJSON();
    console.log(`  "${OTHER}" created (#${other.id}, sort order ${nextOrder})`);
  } else {
    console.log(`  would create "${OTHER}" (sort order ${nextOrder})`);
  }

  // ── Who gets Other, and for WHICH types ───────────────────────────────────
  //
  // EVERY type now, not just `report`. Other started as the queue a report request
  // lands in when nobody knows whose data it is about, so it was granted to report
  // workers alone. The submit form now asks which application on EVERY branch and
  // offers Other on all of them — somebody reporting a defect in a system the
  // portal does not list needs somewhere to put it too.
  //
  // **That grant is not optional.** Scoping fails closed: a defect filed into Other
  // with nobody holding a defect grant there would be visible to nobody but a super
  // user, which is the exact failure Other was invented to avoid.
  //
  // Derived from the grants that exist, per type, so it stays right as people come
  // and go: somebody holding an all-types grant ('') anywhere gets '' on Other,
  // because that is the same statement. Everybody else gets one row per narrowed
  // type they actually work — an analyst still only sees report requests here.
  const grants = await UserApplicationRole.findAll({
    attributes: ['user_id', 'application_id', 'role', 'request_type'],
    raw: true,
  });
  const workers = new Map();
  for (const grant of grants) {
    if (String(grant.role || '').toLowerCase() === 'viewer') continue; // reads, cannot route
    const userId = Number(grant.user_id);
    const type = String(grant.request_type || '').trim().toLowerCase();
    const role = String(grant.role || 'admin').toLowerCase();
    if (!workers.has(userId)) workers.set(userId, { role, types: new Set() });
    const entry = workers.get(userId);
    // The strongest role they hold anywhere: an admin on one application should not
    // arrive at Other as a viewer.
    if (entry.role !== 'manager') entry.role = role === 'manager' ? 'manager' : entry.role;
    entry.types.add(type);
  }
  // An all-types grant supersedes the narrower ones — the same rule the Access
  // page's bulk grants follow.
  const reportWorkers = new Map();
  for (const [userId, entry] of workers) {
    const types = entry.types.has('') ? [''] : [...entry.types].sort();
    reportWorkers.set(userId, { role: entry.role, types });
  }

  const people = await User.findAll({
    attributes: ['id', 'username', 'display_name', 'is_super_user'],
    raw: true,
  });
  const nameById = new Map(people.map((row) => [Number(row.id), row.display_name || row.username]));
  const superUsers = people.filter((row) => Number(row.is_super_user) === 1)
    .map((row) => row.username);
  if (superUsers.length > 0) {
    console.log(`\nSuper users need no grant — they see every queue: ${superUsers.join(', ')}`);
  }

  const label = (type) => (type === '' ? 'every type' : `${type} requests`);

  if (reportWorkers.size === 0) {
    console.log('\nNobody holds a grant yet, so there is nobody to add.');
  } else {
    console.log(`\n${reportWorkers.size} ${reportWorkers.size === 1 ? 'person works' : 'people work'} the queues:`);
  }

  let added = 0;
  let superseded = 0;
  for (const [userId, { role, types }] of reportWorkers) {
    const who = nameById.get(userId) || `#${userId}`;
    // An every-type grant supersedes the narrower ones — the same rule the Access
    // page's bulk grants follow. Without this, somebody who already held
    // `Other: report` from when this script granted that alone would end up holding
    // BOTH rows, and the Access page would read the pair as "Mixed" rather than as
    // the every-type grant it actually is.
    if (types.length === 1 && types[0] === '' && other) {
      const narrower = await UserApplicationRole.findAll({
        where: { user_id: userId, application_id: Number(other.id) },
        attributes: ['id', 'request_type'],
        raw: true,
      });
      const toDrop = narrower.filter((row) => String(row.request_type || '').trim() !== '');
      for (const row of toDrop) {
        if (APPLY) {
          await UserApplicationRole.destroy({ where: { id: row.id } });
          superseded += 1;
          console.log(`  ${who}: dropped the narrower ${OTHER}/${row.request_type} grant — superseded by every type`);
        } else {
          console.log(`  ${who}: would drop the narrower ${OTHER}/${row.request_type} grant — superseded by every type`);
        }
      }
    }
    for (const type of types) {
      if (!other) {
        console.log(`  ${who}: would get ${role} on ${OTHER} for ${label(type)}`);
        continue;
      }
      const existing = await UserApplicationRole.findOne({
        where: {
          user_id: userId,
          application_id: Number(other.id),
          request_type: type,
        },
        raw: true,
      });
      if (existing) {
        console.log(`  ${who}: already ${existing.role} on ${OTHER} for ${label(type)}`);
        continue;
      }
      if (APPLY) {
        await UserApplicationRole.create({
          user_id: userId,
          application_id: Number(other.id),
          role,
          request_type: type,
          granted_at: new Date().toISOString(),
          granted_by: 'seed:other-application',
        });
        added += 1;
        console.log(`  ${who}: granted ${role} on ${OTHER} for ${label(type)}`);
      } else {
        console.log(`  ${who}: would get ${role} on ${OTHER} for ${label(type)}`);
      }
    }
  }

  const applicationsAfter = await Application.count();
  const grantsAfter = await UserApplicationRole.count();
  console.log(`\n${applicationsAfter} applications, ${grantsAfter} grants after.`);
  if (APPLY) {
    console.log(`Added ${added} grant${added === 1 ? '' : 's'} on ${OTHER}`
      + `${superseded > 0 ? `, dropped ${superseded} superseded by an every-type grant` : ''}.`);
    console.log('An Other request is routed to its real application with the Redirect action,'
      + ' which records the hand-off in submission_routings.');
  } else {
    console.log('DRY RUN. Re-run with --apply to write.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => dbApi.close().catch(() => {}));
