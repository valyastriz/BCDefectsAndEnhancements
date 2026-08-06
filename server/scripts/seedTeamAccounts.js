#!/usr/bin/env node
/**
 * The eight working accounts, with their per-application, per-type grants.
 *
 *   npm run seed:team-accounts            # dry run — says what it would do
 *   npm run seed:team-accounts -- --apply # write
 *
 * DRY RUN BY DEFAULT, and idempotent: an account that exists is left alone (its
 * password is never rewritten), and a grant that exists is only touched if its
 * role differs from the one declared here.
 *
 * WHY THE GRANTS LOOK LIKE THIS. `user_application_roles` is
 * (user_id, application_id, role, request_type), where `request_type` is '' for
 * "every type" and a type name for a narrowed grant. So:
 *
 *   - An APPLICATION ADMIN for defects and enhancements is TWO rows, one per
 *     type, not one row with two values. Cleanup tasks are covered by them: a
 *     cleanup is stored as a defect or an enhancement with a flag, not as a type
 *     of its own.
 *   - An ANALYST is one row narrowed to `report`. That is the whole of what
 *     "analysts are admins configured to certain types of requests" means — there
 *     is no fourth role.
 *   - Somebody who does both is three rows. Grants add up; they do not conflict.
 *
 * WHAT THIS DELIBERATELY DOES NOT GIVE ANYONE: the `manager` rank. It is a rank
 * above admin, per application, and it gates exactly one thing — seeing OTHER
 * PEOPLE's throughput numbers. Nobody asked for that, and handing it out because
 * an account sounds senior is how a privacy decision gets made by accident. Add it
 * deliberately (`role: 'manager'` on that application's row) if a product owner
 * should see their team's figures rather than only their own.
 *
 * ACCOUNT-LEVEL ROLE. `users.role` is the door; the grants below are the rooms.
 * Two values may sign in (see accountMaySignIn in src/constants.js):
 *
 *   'admin' — the six triage accounts. What they administer is their grants.
 *   'rep'   — the two REP accounts at the end, who hold NO grants at all. A rep
 *             files requests and follows the ones they filed; ensureAdmin refuses
 *             them like a stranger, and the header shows them no Admin link.
 *             They exist because a report request is only visible to the person
 *             who filed it, and that needs somebody to be.
 *
 * `is_super_user` stays 0 on all eight: only `admin` is a super user.
 *
 * A REP IS NOT SCOPED TO ONE APPLICATION. Their "home" application prefills the
 * submit form and nothing more — they may file against any of them, which is why
 * it is a directory-group default (application_ad_groups) rather than a grant.
 *
 * PASSWORDS. All eight are seeded with SEED_ADMIN_PASSWORD (or ADMIN_PASSWORD),
 * exactly as `npm run seed:admin` does for the original accounts — one shared test
 * password on a prototype whose data is test data. **Change them before anybody
 * real signs in.** An existing account's password is never touched by a re-run.
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const dbApi = require('../db');

const APPLY = process.argv.includes('--apply');
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'admin123';

const BILLING = 'Billing Center';
const POLICY = 'Policy Center';

// Defects and enhancements, as two grants. Cleanups ride along with them.
const WORK_TYPES = ['defect', 'enhancement'];

const ACCOUNTS = [
  {
    username: 'pc_app_admin',
    displayName: 'Policy Center App Admin',
    email: 'pc.appadmin@example.invalid',
    what: 'Application admin for Policy Center defects and enhancements',
    grants: WORK_TYPES.map((requestType) => ({ application: POLICY, role: 'admin', requestType })),
  },
  {
    username: 'bc_app_admin',
    displayName: 'Billing Center App Admin',
    email: 'bc.appadmin@example.invalid',
    what: 'Application admin for Billing Center defects and enhancements',
    grants: WORK_TYPES.map((requestType) => ({ application: BILLING, role: 'admin', requestType })),
  },
  {
    username: 'pc_report_analyst',
    displayName: 'Policy Center Report Analyst',
    email: 'pc.analyst@example.invalid',
    what: 'Report requests only, Policy Center — no defects or enhancements',
    grants: [{ application: POLICY, role: 'admin', requestType: 'report' }],
  },
  {
    username: 'bc_report_analyst',
    displayName: 'Billing Center Report Analyst',
    email: 'bc.analyst@example.invalid',
    what: 'Report requests only, Billing Center — no defects or enhancements',
    grants: [{ application: BILLING, role: 'admin', requestType: 'report' }],
  },
  {
    username: 'pc_owner_analyst',
    displayName: 'Policy Center Owner & Analyst',
    email: 'pc.owner@example.invalid',
    what: 'Policy Center product owner (defects and enhancements) AND report analyst',
    grants: [
      ...WORK_TYPES.map((requestType) => ({ application: POLICY, role: 'admin', requestType })),
      { application: POLICY, role: 'admin', requestType: 'report' },
    ],
  },
  {
    username: 'bc_owner_analyst',
    displayName: 'Billing Center Owner & Analyst',
    email: 'bc.owner@example.invalid',
    what: 'Billing Center product owner (defects and enhancements) AND report analyst',
    grants: [
      ...WORK_TYPES.map((requestType) => ({ application: BILLING, role: 'admin', requestType })),
      { application: BILLING, role: 'admin', requestType: 'report' },
    ],
  },
  // ── Requesters ─────────────────────────────────────────────────────────────
  // No grants, on purpose: a grant is a right to work OTHER people's tickets, and
  // a rep has none. Everything they can do follows from being signed in.
  {
    username: 'pc_rep',
    displayName: 'Pat Rep (Policy Center)',
    email: 'pc.rep@example.invalid',
    accountRole: 'rep',
    what: 'Requester who mostly files for Policy Center — may file for any application',
    grants: [],
  },
  {
    username: 'bc_rep',
    displayName: 'Bailey Rep (Billing Center)',
    email: 'bc.rep@example.invalid',
    accountRole: 'rep',
    what: 'Requester who mostly files for Billing Center — may file for any application',
    grants: [],
  },
];

async function main() {
  await dbApi.init();
  const models = dbApi.getModels() || {};
  const { User, Application, UserApplicationRole } = models;
  if (!User || !Application || !UserApplicationRole) {
    throw new Error('User, Application or UserApplicationRole model is not initialized');
  }

  // Printed first, always: dotenv resolves `.env` from the CWD, so running this
  // from the repo root silently targets the local sql.js file instead of the
  // hosted database. Run it from `server/`, and read this line before believing
  // anything below it.
  const dialect = User.sequelize.getDialect();
  const usersBefore = await User.count();
  const grantsBefore = await UserApplicationRole.count();
  console.log(`${dialect} · ${usersBefore} users, ${grantsBefore} grants before`);

  const applications = await Application.findAll({ attributes: ['id', 'name'], raw: true });
  const applicationByName = new Map(
    applications.map((row) => [String(row.name).trim().toLowerCase(), Number(row.id)]),
  );
  const missingApplications = [...new Set(ACCOUNTS.flatMap((account) => account.grants)
    .map((grant) => grant.application))]
    .filter((name) => !applicationByName.has(name.toLowerCase()));
  if (missingApplications.length > 0) {
    throw new Error(`No such application: ${missingApplications.join(', ')}. Nothing was changed.`);
  }

  const passwordHash = APPLY ? await bcrypt.hash(PASSWORD, 10) : '';
  let createdUsers = 0;
  let createdGrants = 0;
  let correctedGrants = 0;

  for (const account of ACCOUNTS) {
    console.log(`\n${account.username} — ${account.what}`);

    let user = await User.findOne({ where: { username: account.username }, raw: true });
    if (user) {
      console.log('  account: already present, left as it is (password untouched)');
    } else if (APPLY) {
      user = (await User.create({
        username: account.username,
        password_hash: passwordHash,
        // The door. Per-application rights are the grants below.
        role: account.accountRole || 'admin',
        display_name: account.displayName,
        email: account.email,
        is_super_user: 0,
      })).toJSON();
      createdUsers += 1;
      console.log(`  account: created (#${user.id}) as ${account.accountRole || 'admin'}, password = the seeded one`);
    } else {
      console.log('  account: would create');
    }

    if (account.grants.length === 0) {
      console.log('  grants: none, deliberately — a requester works nobody\'s tickets');
    }

    for (const grant of account.grants) {
      const applicationId = applicationByName.get(grant.application.toLowerCase());
      const scope = grant.requestType || 'every type';
      if (!user) {
        console.log(`  grant: would add ${grant.role} on ${grant.application} for ${scope}`);
        continue;
      }
      const existing = await UserApplicationRole.findOne({
        where: {
          user_id: Number(user.id),
          application_id: applicationId,
          request_type: grant.requestType || '',
        },
        raw: true,
      });
      if (existing && String(existing.role) === grant.role) {
        console.log(`  grant: ${grant.role} on ${grant.application} for ${scope} — already present`);
        continue;
      }
      if (existing) {
        console.log(`  grant: ${grant.application}/${scope} is ${existing.role}, declared ${grant.role}`
          + `${APPLY ? ' — corrected' : ' — would correct'}`);
        if (APPLY) {
          await UserApplicationRole.update({ role: grant.role }, { where: { id: existing.id } });
          correctedGrants += 1;
        }
        continue;
      }
      if (APPLY) {
        await UserApplicationRole.create({
          user_id: Number(user.id),
          application_id: applicationId,
          role: grant.role,
          request_type: grant.requestType || '',
          granted_at: new Date().toISOString(),
          granted_by: 'seed:team-accounts',
        });
        createdGrants += 1;
        console.log(`  grant: added ${grant.role} on ${grant.application} for ${scope}`);
      } else {
        console.log(`  grant: would add ${grant.role} on ${grant.application} for ${scope}`);
      }
    }
  }

  const usersAfter = await User.count();
  const grantsAfter = await UserApplicationRole.count();
  console.log(`\n${usersAfter} users, ${grantsAfter} grants after`);
  if (APPLY) {
    console.log(`Created ${createdUsers} accounts and ${createdGrants} grants; corrected ${correctedGrants}.`);
    console.log('Nobody was given the `manager` rank — see this file\'s header.');
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
