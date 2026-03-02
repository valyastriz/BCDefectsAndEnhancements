const dotenv = require('dotenv');
dotenv.config();
const { createSequelize } = require('../db/sequelize');

async function check() {
  const { sequelize } = createSequelize();

  const [rows] = await sequelize.query(`
    SELECT
      COUNT(*) FILTER (WHERE type_id IS NULL) AS missing_type_id,
      COUNT(*) FILTER (WHERE status_id IS NULL) AS missing_status_id,
      COUNT(*) FILTER (WHERE application_id IS NULL) AS missing_application_id,
      COUNT(*) FILTER (WHERE created_via_id IS NULL) AS missing_created_via_id,
      COUNT(*) FILTER (WHERE cleanup_status_id IS NULL AND is_cleanup = 1) AS missing_cleanup_status_id,
      COUNT(*) FILTER (WHERE cleanup_tag_type_id IS NULL AND is_cleanup = 1) AS missing_cleanup_tag_type_id,
      COUNT(*) FILTER (WHERE enhancement_request_type_id IS NULL AND enhancement_request_type IS NOT NULL AND enhancement_request_type != '') AS missing_enhancement_request_type_id,
      COUNT(*) FILTER (WHERE priority_level_id IS NULL AND priority_level IS NOT NULL AND priority_level != '') AS missing_priority_level_id,
      COUNT(*) AS total
    FROM submissions
  `);

  console.log('\n=== Lookup ID Audit (production Supabase) ===');
  console.log(`Total submissions: ${rows[0].total}`);
  console.log('');
  const fields = [
    ['type_id', 'missing_type_id'],
    ['status_id', 'missing_status_id'],
    ['application_id', 'missing_application_id'],
    ['created_via_id', 'missing_created_via_id'],
    ['cleanup_status_id (is_cleanup rows only)', 'missing_cleanup_status_id'],
    ['cleanup_tag_type_id (is_cleanup rows only)', 'missing_cleanup_tag_type_id'],
    ['enhancement_request_type_id (where text col set)', 'missing_enhancement_request_type_id'],
    ['priority_level_id (where text col set)', 'missing_priority_level_id'],
  ];
  let allGood = true;
  for (const [label, key] of fields) {
    const count = Number(rows[0][key]);
    const status = count === 0 ? '✅ OK' : `❌ MISSING: ${count} rows`;
    console.log(`  ${label}: ${status}`);
    if (count > 0) allGood = false;
  }
  console.log('');
  if (allGood) {
    console.log('✅ All lookup IDs are populated — safe to drop text columns.');
  } else {
    console.log('⚠️  Some rows are missing IDs — backfill required before dropping columns.');
  }

  await sequelize.close();
}

check().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
