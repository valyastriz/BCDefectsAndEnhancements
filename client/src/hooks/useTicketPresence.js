import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '../lib/socket';
import { msSince } from '../utils/formatUtils';

const STALE_AFTER_MS = 30 * 60 * 1000; // 30 minutes without activity → "may have stepped away"
const ACTIVITY_THROTTLE_MS = 10 * 1000;

/**
 * Advisory presence / soft-lock for the open detail modal.
 *
 * Announces `ticket:enter`/`ticket:leave` as the modal opens/closes and listens
 * for `ticket:presence` broadcasts. The "holder" is the earliest opener still
 * connected; if that isn't this socket, the ticket is held by someone else.
 *
 * @param {Object} deps
 * @param {number|null} deps.openId - currently open submission id
 * @param {string} [deps.currentUsername] - the signed-in admin's username
 */
export function useTicketPresence({ openId, currentUsername }) {
  const [holder, setHolder] = useState(null);
  const [, setTick] = useState(0);
  const activityCoolingRef = useRef(false);

  // Re-render once a minute so "last active … ago" and the stale flag stay fresh.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // Listen for presence broadcasts targeting the open ticket.
  useEffect(() => {
    const socket = getSocket();
    const onPresence = (data) => {
      if (!openId || Number(data?.submissionId) !== Number(openId)) return;
      setHolder(data.holder || null);
    };
    socket.on('ticket:presence', onPresence);
    return () => socket.off('ticket:presence', onPresence);
  }, [openId]);

  // Announce enter on open, leave on close / id change. Presence is tracked per
  // socket connection server-side and wiped on disconnect, so re-announce on
  // every (re)connect — otherwise a network blip silently drops the soft-lock
  // while the modal is still open.
  useEffect(() => {
    if (!openId) return undefined;
    const socket = getSocket();
    const announce = () => socket.emit('ticket:enter', { submissionId: openId });
    announce();
    socket.on('connect', announce);
    return () => {
      socket.off('connect', announce);
      socket.emit('ticket:leave', { submissionId: openId });
      setHolder(null);
    };
  }, [openId]);

  // Throttled activity ping — keeps the holder's "last active" fresh as they work.
  const markActivity = useCallback(() => {
    if (!openId || activityCoolingRef.current) return;
    activityCoolingRef.current = true;
    getSocket().emit('ticket:activity', { submissionId: openId });
    setTimeout(() => { activityCoolingRef.current = false; }, ACTIVITY_THROTTLE_MS);
  }, [openId]);

  const isHeldByOther = Boolean(holder && holder.socketId && holder.socketId !== getSocket().id);
  const staleMs = msSince(holder?.lastActivityAt);
  const isStale = Boolean(isHeldByOther && staleMs != null && staleMs > STALE_AFTER_MS);
  const holderIsSelf = Boolean(isHeldByOther && holder?.username && holder.username === currentUsername);

  return {
    isHeldByOther,
    isStale,
    holderIsSelf,
    holderName: holder?.username || null,
    holderOpenedAt: holder?.openedAt || null,
    holderLastActivityAt: holder?.lastActivityAt || null,
    markActivity,
  };
}
