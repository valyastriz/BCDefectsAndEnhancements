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
 * WHO GETS A GRANT ON IT. Everybody who works report requests anywhere —
 * DERIVED from the grants that exist rather than a list typed in here, so it stays
 * right as people come and go. Somebody holding an all-types grant ('') works
 * report requests too, so they are included; their grant on Other is narrowed to
 * `report`, because Other exists for requests whose application is not yet known,
 * and that only happens to a report request.
 *
 * Re-run it after granting somebody new: it adds the missing rows and nothing else.
 */
require('dotenv').config();
const dbApi = require('../db');
const { SUBMISSION_TYPE_REPORT } = require('../src/constants');

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

  // Everyone who works report requests somewhere. '' is an all-types grant, which
  // covers report requests, so those people work them too.
  const grants = await UserApplicationRole.findAll({
    attributes: ['user_id', 'application_id', 'role', 'request_type'],
    raw: true,
  });
  const reportWorkers = new Map();
  for (const grant of grants) {
    const type = String(grant.request_type || '').trim().toLowerCase();
    if (type !== '' && type !== SUBMISSION_TYPE_REPORT) continue;
    if (String(grant.role || '').toLowerCase() === 'viewer') continue; // reads, cannot route
    // The strongest role they hold anywhere: an admin on one application should
    // not arrive at Other as a viewer.
    const current = reportWorkers.get(Number(grant.user_id));
    reportWorkers.set(
      Number(grant.user_id),
      current === 'manager' ? current : String(grant.role || 'admin').toLowerCase(),
    );
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

  if (reportWorkers.size === 0) {
    console.log('\nNobody holds a report-request grant yet, so there is nobody to add.');
  } else {
    console.log(`\n${reportWorkers.size} ${reportWorkers.size === 1 ? 'person works' : 'people work'} report requests:`);
  }

  let added = 0;
  for (const [userId, role] of reportWorkers) {
    const who = nameById.get(userId) || `#${userId}`;
    if (!other) {
      console.log(`  ${who}: would get ${role} on ${OTHER} for report requests`);
      continue;
    }
    const existing = await UserApplicationRole.findOne({
      where: {
        user_id: userId,
        application_id: Number(other.id),
        request_type: SUBMISSION_TYPE_REPORT,
      },
      raw: true,
    });
    if (existing) {
      console.log(`  ${who}: already ${existing.role} on ${OTHER} for report requests`);
      continue;
    }
    if (APPLY) {
      await UserApplicationRole.create({
        user_id: userId,
        application_id: Number(other.id),
        role,
        request_type: SUBMISSION_TYPE_REPORT,
        granted_at: new Date().toISOString(),
        granted_by: 'seed:other-application',
      });
      added += 1;
      console.log(`  ${who}: granted ${role} on ${OTHER} for report requests`);
    } else {
      console.log(`  ${who}: would get ${role} on ${OTHER} for report requests`);
    }
  }

  const applicationsAfter = await Application.count();
  const grantsAfter = await UserApplicationRole.count();
  console.log(`\n${applicationsAfter} applications, ${grantsAfter} grants after.`);
  if (APPLY) {
    console.log(`Added ${added} grant${added === 1 ? '' : 's'} on ${OTHER}.`);
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
