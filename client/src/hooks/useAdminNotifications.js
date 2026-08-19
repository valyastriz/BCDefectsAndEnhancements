import { useEffect, useState } from 'react';
import { getSocket } from '../lib/socket';

/**
 * Custom hook for admin real-time notifications (socket, toasts, unread count).
 *
 * @param {Object} deps
 * @param {Function} deps.loadRows - reload the main submissions table
 * @param {number|null} deps.openId - currently open detail modal submission ID
 * @param {Function} deps.openDetail - open/refresh a submission detail
 * @param {boolean} deps.isAnyAdminModalOpen - whether any admin modal is open
 * @param {Function} deps.setNotice - page-level notice setter
 * @returns Notification state (toasts, unreadCount) and setters
 */
export function useAdminNotifications({ loadRows, openId, openDetail, isAnyAdminModalOpen, setNotice, onRemoteUpdate }) {
  const [submissionToasts, setSubmissionToasts] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // ── Request browser notification permission once on mount ───────────────────

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // ── Update document title with unread count ────────────────────────────────

  useEffect(() => {
    const base = 'Admin Queue | BC Defects & Enhancements';
    document.title = unreadCount > 0 ? `(${unreadCount}) ${base}` : base;
  }, [unreadCount]);

  // ── Reset unread count when tab becomes visible ────────────────────────────

  useEffect(() => {
    const onVisible = () => { if (!document.hidden) setUnreadCount(0); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // ── Socket listener for admin:notification ─────────────────────────────────

  useEffect(() => {
    const socket = getSocket();
    const onNotification = (payload) => {
      const message = payload?.event ? `Live update: ${payload.event}` : 'Live update received';
      if (!isAnyAdminModalOpen) setNotice(message);
      loadRows();
      if (openId) openDetail(openId, true);

      // Warn an admin whose modal is open if another admin just changed that item.
      if (payload?.event === 'submission:updated' && payload?.payload) {
        onRemoteUpdate?.({
          id: payload.payload.id,
          updatedBy: payload.payload.updatedBy,
          updatedAt: payload.payload.updated_at,
        });
      }

      if (payload?.event === 'submission:new') {
        const sub = payload?.payload;
        // Only alert for submissions from the public rep form, not admin-created entries
        if (sub?.created_via !== 'rep_form') return;
        if (document.hidden) {
          // Tab is not visible — bump the title counter only
          setUnreadCount((c) => c + 1);
        } else {
          // Tab is visible — show in-app toast
          const toastId = Date.now();
          setSubmissionToasts((prev) => [
            ...prev,
            {
              id: toastId,
              heading: sub?.summary_of_issue || 'New submission received',
              from: sub?.created_by || null,
              type: sub?.type ? sub.type.charAt(0).toUpperCase() + sub.type.slice(1) : null,
            },
          ]);
          setTimeout(() => {
            setSubmissionToasts((prev) => prev.filter((t) => t.id !== toastId));
          }, 8000);
        }

        // Attempt OS desktop notification regardless of tab visibility
        if ('Notification' in window && Notification.permission === 'granted') {
          const heading = sub?.summary_of_issue || 'New submission received';
          const bodyParts = [
            sub?.created_by ? `From: ${sub.created_by}` : null,
            sub?.type ? `Type: ${sub.type.charAt(0).toUpperCase() + sub.type.slice(1)}` : null,
          ].filter(Boolean);
          try {
            const n = new Notification('\u{1F4CA} New Submission', {
              body: bodyParts.length ? `${heading}\n${bodyParts.join(' \u00B7 ')}` : heading,
              icon: '/favicon.ico',
            });
            n.onclick = () => { window.focus(); n.close(); };
          } catch { /* silently ignore */ }
        }
      }

      // \u2500\u2500 Somebody is blocked and waiting \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      //
      // The one event here that is about a PERSON rather than a row, so it gets
      // the full treatment \u2014 toast, desktop notification, unread badge \u2014 while
      // an ordinary recurrence just refreshes the queue through the reload
      // above. Blocked means they cannot finish their work today; a number
      // ticking up on a row they are not looking at would not reach anyone.
      if (payload?.event === 'submission:workaround-requested') {
        const sub = payload?.payload?.submission;
        const who = payload?.payload?.reported_by || 'Someone';
        const blockedOn = payload?.payload?.blocked_on || '';
        const heading = `${who} is blocked${sub?.application_name ? ` \u2014 ${sub.application_name}` : ''}`;
        const detail = sub?.summary_of_issue || 'An existing ticket';

        if (document.hidden) {
          setUnreadCount((c) => c + 1);
        } else {
          const toastId = Date.now();
          setSubmissionToasts((prev) => [
            ...prev,
            { id: toastId, heading, from: detail, type: 'Needs a workaround', tone: 'blocked' },
          ]);
          // Held twice as long as a new-submission toast: this one asks somebody
          // to do something today, so it should outlast a glance away.
          setTimeout(() => {
            setSubmissionToasts((prev) => prev.filter((t) => t.id !== toastId));
          }, 16000);
        }

        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            const n = new Notification('\u{26A0}\u{FE0F} Someone is blocked', {
              body: [heading, detail, blockedOn].filter(Boolean).join('\n'),
              icon: '/favicon.ico',
            });
            n.onclick = () => { window.focus(); n.close(); };
          } catch { /* silently ignore */ }
        }
      }
    };

    socket.on('admin:notification', onNotification);
    return () => {
      socket.off('admin:notification', onNotification);
    };
  }, [loadRows, openId, openDetail, isAnyAdminModalOpen, setNotice, onRemoteUpdate]);

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    submissionToasts,
    setSubmissionToasts,
    unreadCount,
  };
}
