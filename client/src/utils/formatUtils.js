// ── Formatting utilities (pure functions, no component dependencies) ─────────
import { RETIRED_STATUS, CLEANUP_ONLY_STATUS } from '../constants/adminConstants';
import { TRACKER_LABEL } from '../constants/tracker';

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
    admin_easyvista_resubmission: `${TRACKER_LABEL} Resubmission`,
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
 * Today as the `YYYY-MM-DD` an `<input type="date">` speaks — the `max` for any
 * question about something that has already happened.
 *
 * Built from the LOCAL calendar rather than `toISOString().slice(0, 10)`, which
 * is UTC: west of Greenwich that returns yesterday for the whole evening, and a
 * ceiling of yesterday refuses a defect somebody is reporting as it happens.
 */
export function todayInputValue() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
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
 * Extract a usable requester email from a submission, or '' if absent.
 * (created_by_email is stored as '-' when the form was submitted without one.)
 */
export function getRequesterEmail(detail) {
  const email = String(detail?.created_by_email || '').trim();
  return email.includes('@') ? email : '';
}

/**
 * Build a mailto: URL that opens a prefilled draft responding to the
 * requester of a submission. When no usable email is on file the recipient
 * is left blank for the admin to fill in. mailto bodies are plain text
 * only, so this stays compact — key identifiers, not the full submission
 * narrative.
 */
export function buildRespondToUserMailto(detail) {
  const email = getRequesterEmail(detail);

  const typeLabel = formatMetaTypeLabel(detail.type) || 'Submission';
  const summary = String(detail.summary_of_issue || '').trim();
  const subject = `RE: ${typeLabel} Submission #${detail.id}${summary ? ` - ${summary}` : ''}`;

  const referenceLines = [
    `Application: ${detail.application_name || 'N/A'}`,
    `Submitted: ${formatDateOnly(detail.created_at)}`,
  ];
  if (detail.policy_num) referenceLines.push(`Policy #: ${detail.policy_num}`);
  if (detail.account_num) referenceLines.push(`Account #: ${detail.account_num}`);
  if (detail.easyvista_ticket_id) referenceLines.push(`${TRACKER_LABEL} Ticket: ${detail.easyvista_ticket_id}`);

  const body = [
    `Hi ${detail.created_by || 'there'},`,
    '',
    `I'm reaching out regarding your ${typeLabel.toLowerCase()} submission #${detail.id}${summary ? `: "${summary}"` : ''}.`,
    '',
    ...referenceLines,
    '',
    '',
  ].join('\r\n');

  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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
