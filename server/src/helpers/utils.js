const { DEFAULT_CLEANUP_TAG_TYPES } = require('../constants');

function toBooleanSql(value) {
  return value ? 1 : 0;
}

/**
 * A flag as it arrives from a request body.
 *
 * `toBooleanSql` is not enough on its own for anything posted as multipart or a
 * query string: `false` crosses the wire as the STRING "false", which is
 * truthy. Only the affirmative spellings count, so anything unrecognised —
 * including that string — reads as off.
 */
function parseBooleanFlag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes' || text === 'on';
}

function toIsoOrNow(input) {
  if (!input) return new Date().toISOString();
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function isBlank(value) {
  return String(value ?? '').trim().length === 0;
}

function toSortableTimestamp(value, fallback) {
  const parsed = new Date(value || fallback || 0);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

// Occurrence rate per month (30.44 days).
const TIMEFRAME_DAYS = { day: 1, week: 7, month: 30.44, quarter: 91.31, year: 365.25 };
function calculateOccurrenceRate(count, timeframeCount, timeframeUnit) {
  if (!Number.isFinite(count) || count <= 0) return null;
  if (!Number.isFinite(timeframeCount) || timeframeCount <= 0) return null;
  const unitKey = String(timeframeUnit || '').trim().toLowerCase();
  const daysPerUnit = TIMEFRAME_DAYS[unitKey];
  if (!daysPerUnit) return null;
  const totalDays = timeframeCount * daysPerUnit;
  // Rate = occurrences per 30.44 days (month)
  return (count / totalDays) * 30.44;
}

function normalizeCleanupTagType(value, allowedCleanupTagTypes = DEFAULT_CLEANUP_TAG_TYPES) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowedCleanupTagTypes.includes(normalized) ? normalized : null;
}

function defectDateTimeIso(body) {
  if (!isBlank(body.date_time_of_error)) {
    return toIsoOrNow(body.date_time_of_error);
  }

  const dateValue = String(body.date_of_error || '').trim();
  if (!dateValue) {
    return null;
  }

  const timeValue = String(body.time_of_error || '').trim() || '00:00';
  const parsed = new Date(`${dateValue}T${timeValue}`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

module.exports = {
  toBooleanSql,
  parseBooleanFlag,
  toIsoOrNow,
  isBlank,
  toSortableTimestamp,
  TIMEFRAME_DAYS,
  calculateOccurrenceRate,
  normalizeCleanupTagType,
  defectDateTimeIso,
};
