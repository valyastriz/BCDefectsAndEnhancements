// Grant (or revoke) portal super-user rights.
//
//   node scripts/grantSuperUser.js admin                 # dry run: report only
//   node scripts/grantSuperUser.js admin --apply         # grant to `admin`
//   node scripts/grantSuperUser.js admin ops_admin --apply
//   node scripts/grantSuperUser.js --all-admins --apply  # every role='admin' user
//   node scripts/grantSuperUser.js admin --revoke --apply
//
// A super user sees every application's queue and bypasses the per-application
// scoping in user_application_roles. That bypass is the one hole in fail-closed
// access control, so granting it is a deliberate act with a named target rather
// than something that happens to a class of users automatically.
//
// Deliberately NOT part of migrateWithModels. If a deploy-time migration promoted
// every role='admin' user, then demoting someone from the Access page would be
// silently undone by the next deploy — the schema would keep overruling an
// administrator's decision.
//
// NOTE: this targets whatever DB the environment points at (server/.env). With
// DB_PROVIDER=postgres that is the live Supabase database.

const dotenv = require('dotenv');

dotenv.config();

const dbApi = require('../db');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const REVOKE = argv.includes('--revoke');
const ALL_ADMINS = argv.includes('--all-admins');
const usernames = argv.filter((arg) => !arg.startsWith('--'));

const targetValue = REVOKE ? 0 : 1;
const verb = REVOKE ? 'Revoke' : 'Grant';

async function run() {
  if (!ALL_ADMINS && usernames.length === 0) {
    console.error('Name at least one username, or pass --all-admins.');
    process.exit(1);
  }

  await dbApi.init();
  const { User } = dbApi.getModels() || {};
  if (!User) {
    console.error('User model not initialized.');
    process.exit(1);
  }

  console.log(`DB provider: ${process.env.DB_PROVIDER || '(default)'}`);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}\n`);

  const where = ALL_ADMINS ? { role: 'admin' } : { username: usernames };
  const targets = await User.findAll({ where, order: [['id', 'ASC']] });

  if (targets.length === 0) {
    console.log('No matching users. Nothing to do.');
    return;
  }

  if (!ALL_ADMINS) {
    const found = new Set(targets.map((user) => user.username));
    const missing = usernames.filter((name) => !found.has(name));
    if (missing.length > 0) {
      console.error(`Unknown username(s): ${missing.join(', ')}`);
      console.error('Refusing to run so a typo cannot silently grant nothing.');
      process.exit(1);
    }
  }

  const changing = targets.filter((user) => Number(user.is_super_user || 0) !== targetValue);
  const alreadyCorrect = targets.filter((user) => Number(user.is_super_user || 0) === targetValue);

  for (const user of targets) {
    const current = Number(user.is_super_user || 0) === 1 ? 'super user' : 'not a super user';
    const changes = Number(user.is_super_user || 0) !== targetValue;
    console.log(`  #${user.id} ${user.username} (role=${user.role}) — currently ${current}${changes ? `  ->  ${verb.toUpperCase()}` : '  (no change)'}`);
  }

  console.log(`\n${verb} target: ${changing.length} user(s); ${alreadyCorrect.length} already correct.`);

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write.');
    return;
  }

  if (changing.length === 0) {
    console.log('Nothing to write.');
    return;
  }

  // Fail closed on the last super user: revoking every one of them would leave
  // nobody able to grant access back, and the Access page is super-user-only.
  if (REVOKE) {
    const remaining = await User.count({ where: { is_super_user: 1 } });
    const revoking = changing.length;
    if (remaining - revoking <= 0) {
      console.error(`\nRefusing: this would leave 0 super users, and only a super user can grant access back.`);
      process.exit(1);
    }
  }

  for (const user of changing) {
    await User.update({ is_super_user: targetValue }, { where: { id: user.id } });
    console.log(`  ${verb}ed: ${user.username}`);
  }

  const total = await User.count({ where: { is_super_user: 1 } });
  console.log(`\nDone. Super users now: ${total}.`);
}

run()
  .then(() => dbApi.close())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error('Failed:', error);
    await dbApi.close().catch(() => {});
    process.exit(1);
  });
