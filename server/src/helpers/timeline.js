const { toSortableTimestamp } = require('./utils');

function buildStatusTimeline(submission, rawEvents) {
  const events = Array.isArray(rawEvents) ? rawEvents : [];
  const isCleanupOnly = Boolean(submission?.is_cleanup)
    && String(submission?.cleanup_tag_type || '').trim().toLowerCase() === 'cleanup_only';
  const normalized = events
    .filter((event) => event && event.status)
    .map((event) => ({
      id: event.id,
      submission_id: event.submission_id ?? submission.id,
      status: String(event.status).trim(),
      changed_at: event.changed_at || submission.updated_at,
      changed_by: event.changed_by || null,
    }));

  const hasCleanupStatusEvent = normalized.some(
    (event) => String(event.status || '').startsWith('Cleanup Status:'),
  );

  const hasCreatedEvent = normalized.some((event) => {
    const value = String(event.status || '').trim();
    if (value === 'New') return true;
    if (isCleanupOnly && value.startsWith('Cleanup Status:')) return true;
    return false;
  });

  if (!hasCreatedEvent && submission.created_at) {
    normalized.push({
      id: `synthetic-created-${submission.id}`,
      submission_id: submission.id,
      status: isCleanupOnly ? 'Cleanup Status: New Cleanup item created' : 'New',
      changed_at: submission.created_at,
      changed_by: 'system-synthesized',
    });
  }

  const currentStatus = String(submission.status || '').trim();
  const hasCurrentStatus = normalized.some((event) => {
    const value = String(event.status || '').trim();
    if (!value) return false;
    if (value === currentStatus) return true;
    if (value === `Defect/Enhancement Status: ${currentStatus}`) return true;
    if (isCleanupOnly && value.startsWith('Cleanup Status:')) return true;
    if (isCleanupOnly && value === 'Defect/Enhancement Status: Switched to Cleanup Only') return true;
    return false;
  });

  if (currentStatus && !hasCurrentStatus) {
    if (!isCleanupOnly) {
      normalized.push({
        id: `synthetic-current-${submission.id}`,
        submission_id: submission.id,
        status: currentStatus,
        changed_at: submission.updated_at || submission.created_at || new Date().toISOString(),
        changed_by: submission.reviewer || 'system-synthesized',
      });
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const event of normalized) {
    const key = [event.status, event.changed_at, event.changed_by || ''].join('|');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(event);
  }

  return deduped.sort((left, right) => {
    const byTime = toSortableTimestamp(right.changed_at, submission.updated_at)
      - toSortableTimestamp(left.changed_at, submission.updated_at);
    if (byTime !== 0) return byTime;

    const leftId = Number(left.id);
    const rightId = Number(right.id);
    if (Number.isFinite(leftId) && Number.isFinite(rightId)) {
      return rightId - leftId;
    }
    return String(right.id).localeCompare(String(left.id));
  });
}

module.exports = {
  buildStatusTimeline,
};
