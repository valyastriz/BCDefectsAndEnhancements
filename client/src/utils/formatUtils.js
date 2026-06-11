// ── Formatting utilities (pure functions, no component dependencies) ─────────
import { RETIRED_STATUS, CLEANUP_ONLY_STATUS } from '../constants/adminConstants';

/**
 * Parse a value to a finite number, returning 0 for non-numeric input.
 */
export function toNumeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Normalize a submission type value into a display-friendly label.
 * e.g. 'cleanup_only' → 'Cleanup Only', 'defect' → 'Defect'
 */
export function formatMetaTypeLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'cleanup_only') return 'Cleanup Only';
  if (!normalized) return '';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/**
 * Map a created_via DB value into a human-readable label.
 */
export function formatCreatedViaLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  const knownLabels = {
    rep_form: 'Submit Request Form',
    admin_excel_import: 'Excel Import',
    admin_backdated: 'Backdated Button',
    admin_cleanup: 'Cleanup Button',
    admin_manual: 'Admin Manual',
    admin_easyvista_resubmission: 'EasyVista Resubmission',
  };
  if (knownLabels[normalized]) return knownLabels[normalized];
  return normalized
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Resolve an attachment file path into a usable URL.
 */
export function resolveAttachmentUrl(filePath) {
  const raw = String(filePath || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

/**
 * Check whether an easyvista_submitted_by value indicates automatic submission.
 */
export function isAutoEasyVistaReporter(value) {
  return String(value || '').trim().toLowerCase().startsWith('automatic (system api');
}

/**
 * Format a numeric value as USD currency.
 */
export function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value || 0);
}

/**
 * Format a numeric value with locale-aware separators.
 */
export function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(toNumeric(value));
}

/**
 * Format a date value as a locale date+time string, or '-' if invalid/empty.
 */
export function formatDateTime(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
}

/**
 * Format a date value as a locale date-only string, or '-' if invalid/empty.
 */
export function formatDateOnly(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString();
}

/**
 * Milliseconds elapsed since an ISO timestamp, or null if unparseable.
 */
export function msSince(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Date.now() - parsed.getTime();
}

/**
 * Short relative-time label, e.g. "just now", "4 min ago", "2 hr ago".
 */
export function formatTimeAgo(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const seconds = Math.max(0, Math.round((Date.now() - parsed.getTime()) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Format a timeline status value into a display-friendly label.
 * Requires the dynamic status sets from meta to classify unknown values.
 * @param {string} statusValue - The raw status string
 * @param {Set<string>} dynamicCoreStatusSet - Set of core statuses from admin meta
 * @param {Set<string>} dynamicCleanupStatusSet - Set of cleanup statuses from admin meta
 */
export function formatTimelineStatus(statusValue, dynamicCoreStatusSet, dynamicCleanupStatusSet) {
  const value = String(statusValue || '').trim();
  if (!value) {
    return 'Status update';
  }
  if (value === RETIRED_STATUS) {
    return 'Updated Status: Retired';
  }
  if (value === 'Unretired') {
    return 'Updated Status: Unretired';
  }
  if (value.startsWith('Defect/Enhancement Status:') || value.startsWith('Cleanup Status:')) {
    return value;
  }
  if (dynamicCoreStatusSet.has(value)) {
    return `Defect/Enhancement Status: ${value}`;
  }
  if (dynamicCleanupStatusSet.has(value)) {
    return `Cleanup Status: ${value}`;
  }
  if (value === CLEANUP_ONLY_STATUS) {
    return `Defect/Enhancement Status: ${value}`;
  }
  return value;
}
