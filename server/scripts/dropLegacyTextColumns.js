/**
 * dropLegacyTextColumns.js
 *
 * One-time migration: drops the 8 legacy text columns from the submissions table
 * that have been superseded by proper lookup ID foreign-key columns.
 *
 * SAFE TO RUN: checkLookupIds.js must pass 100% before running this.
 * Idempotent: each DROP is wrapped in a DO block so it won't fail if the
 * column is already gone.
 *
 * Usage:
 *   node scripts/dropLegacyTextColumns.js
 *   node scripts/dropLegacyTextColumns.js --dry-run   (print SQL only, no changes)
 */

const dotenv = require('dotenv');
dotenv.config();
const { createSequelize } = require('../db/sequelize');

const TEXT_COLUMNS_TO_DROP = [
  'created_via',
  'type',
  'application_name',
  'status',
  'cleanup_status',
  'cleanup_tag_type',
  'enhancement_request_type',
  'priority_level',
];

async function dropLegacyTextColumns(dryRun = false) {
  const { provider, sequelize } = createSequelize();

  if (provider !== 'postgres') {
    console.log(`Provider is "${provider}" — this migration only applies to PostgreSQL. Skipping.`);
    await sequelize.close();
    return;
  }

  console.log('\n=== Drop Legacy Text Columns from submissions ===');
  if (dryRun) console.log('DRY RUN — no changes will be made.\n');

  // First verify all IDs are populated (safety check)
  const [auditRows] = await sequelize.query(`
    SELECT
      COUNT(*) FILTER (WHERE type_id IS NULL) AS missing_type_id,
      COUNT(*) FILTER (WHERE status_id IS NULL) AS missing_status_id,
      COUNT(*) FILTER (WHERE application_id IS NULL) AS missing_application_id,
      COUNT(*) FILTER (WHERE created_via_id IS NULL) AS missing_created_via_id,
      COUNT(*) FILTER (WHERE cleanup_status_id IS NULL AND is_cleanup = 1) AS missing_cleanup_status_id,
      COUNT(*) FILTER (WHERE cleanup_tag_type_id IS NULL AND is_cleanup = 1) AS missing_cleanup_tag_type_id,
      COUNT(*) FILTER (WHERE enhancement_request_type_id IS NULL AND enhancement_request_type IS NOT NULL AND enhancement_request_type != '') AS missing_enhancement_request_type_id,
      COUNT(*) FILTER (WHERE priority_level_id IS NULL AND priority_level IS NOT NULL AND priority_level != '') AS missing_priority_level_id
    FROM submissions
  `);

  const audit = auditRows[0];
  const missingCounts = Object.values(audit).map(Number);
  const anyMissing = missingCounts.some((n) => n > 0);

  if (anyMissing) {
    console.error('❌ Safety check FAILED — some rows still have NULL lookup IDs:');
    console.error(JSON.stringify(audit, null, 2));
    console.error('\nRun: node scripts/migrate.js  to backfill, then retry.');
    await sequelize.close();
    process.exit(1);
  }

  console.log('✅ Safety check passed — all lookup IDs are populated.\n');

  for (const column of TEXT_COLUMNS_TO_DROP) {
    const sql = `
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'submissions' AND column_name = '${column}'
        ) THEN
          ALTER TABLE submissions DROP COLUMN "${column}";
          RAISE NOTICE 'Dropped column: ${column}';
        ELSE
          RAISE NOTICE 'Column already gone: ${column}';
        END IF;
      END
      $$;
    `;

    if (dryRun) {
      console.log(`[DRY RUN] Would drop column: submissions.${column}`);
    } else {
      await sequelize.query(sql);
      console.log(`  Dropped: submissions.${column}`);
    }
  }

  console.log('\n✅ Done.');
  await sequelize.close();
}

const dryRun = process.argv.includes('--dry-run');
dropLegacyTextColumns(dryRun).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
