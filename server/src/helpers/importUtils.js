const { IMPORT_COLUMN_TARGETS } = require('../constants');

function normalizeImportHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeStatusToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeImportRow(raw) {
  const normalized = {};
  for (const [key, value] of Object.entries(raw || {})) {
    const normalizedKey = normalizeImportHeader(key);
    if (!normalizedKey || Object.prototype.hasOwnProperty.call(normalized, normalizedKey)) {
      continue;
    }
    normalized[normalizedKey] = value;
  }
  return normalized;
}

function suggestImportMappings(headers = []) {
  const normalizedLookup = new Map();
  for (const header of headers) {
    normalizedLookup.set(normalizeImportHeader(header), header);
  }

  const suggested = {};
  for (const target of IMPORT_COLUMN_TARGETS) {
    const matchedAlias = target.aliases.find((alias) => normalizedLookup.has(alias));
    suggested[target.key] = matchedAlias ? normalizedLookup.get(matchedAlias) : '';
  }
  return suggested;
}

function normalizeColumnMappings(columnMappings) {
  if (!columnMappings || typeof columnMappings !== 'object') return {};
  const normalized = {};
  for (const target of IMPORT_COLUMN_TARGETS) {
    const raw = columnMappings[target.key];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    normalized[target.key] = normalizeImportHeader(trimmed);
  }
  return normalized;
}

function getMappedImportValue(row, targetKey, aliases, columnMappings, fallback = null) {
  const mappedHeader = columnMappings?.[targetKey];
  const keys = [];
  if (mappedHeader) keys.push(mappedHeader);
  if (Array.isArray(aliases)) keys.push(...aliases);
  return getImportValue(row, keys, fallback);
}

function getImportValue(row, aliases, fallback = null) {
  const keys = Array.isArray(aliases) ? aliases : [aliases];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const value = row[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return value;
  }
  return fallback;
}

function parseImportBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  return fallback;
}

function parseImportNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function splitIdentifierTokens(value) {
  if (value === null || value === undefined) return [];
  return String(value)
    .replace(/\r\n?/g, '\n')
    .split(/[\n,;\t|]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function classifyIdentifierToken(token) {
  const normalized = String(token || '').trim().replace(/\s+/g, '');
  if (!normalized) return { kind: 'unknown', value: '' };
  if (/^\d{7}(-\d{2})?$/.test(normalized)) {
    return { kind: 'policy', value: normalized };
  }
  const accountDigits = normalized.replace(/[^\d]/g, '');
  if (accountDigits.length === 10) {
    return { kind: 'account', value: accountDigits };
  }
  return { kind: 'unknown', value: normalized };
}

function dedupeValues(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function parsePolicyAndAccountNumbers(row, options = {}) {
  const columnMappings = normalizeColumnMappings(options?.columnMappings || {});
  const combinedValue = getMappedImportValue(
    row,
    'combined_policy_account',
    ['policy_account', 'policy_account_num', 'policy_account_number', 'policy_or_account'],
    columnMappings,
    '',
  );

  const policyCandidates = [
    getMappedImportValue(row, 'policy_num', ['policy_num', 'policy_number'], columnMappings, ''),
    combinedValue,
  ];
  const accountCandidates = [
    getMappedImportValue(row, 'account_num', ['account_num', 'account_number'], columnMappings, ''),
    combinedValue,
  ];

  const policyValues = [];
  const accountValues = [];

  for (const candidate of policyCandidates) {
    for (const token of splitIdentifierTokens(candidate)) {
      const parsed = classifyIdentifierToken(token);
      if (parsed.kind === 'policy') {
        policyValues.push(parsed.value);
      } else if (parsed.kind === 'account') {
        accountValues.push(parsed.value);
      }
    }
  }

  for (const candidate of accountCandidates) {
    for (const token of splitIdentifierTokens(candidate)) {
      const parsed = classifyIdentifierToken(token);
      if (parsed.kind === 'account') {
        accountValues.push(parsed.value);
      } else if (parsed.kind === 'policy') {
        policyValues.push(parsed.value);
      }
    }
  }

  const uniquePolicies = dedupeValues(policyValues);
  const uniqueAccounts = dedupeValues(accountValues);

  return {
    policyNum: uniquePolicies.length > 0 ? uniquePolicies.join(', ') : null,
    accountNum: uniqueAccounts.length > 0 ? uniqueAccounts.join(', ') : null,
  };
}

module.exports = {
  normalizeImportHeader,
  normalizeStatusToken,
  normalizeImportRow,
  suggestImportMappings,
  normalizeColumnMappings,
  getMappedImportValue,
  getImportValue,
  parseImportBoolean,
  parseImportNumber,
  splitIdentifierTokens,
  classifyIdentifierToken,
  dedupeValues,
  parsePolicyAndAccountNumbers,
};
