import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Notice } from '../components/bite-size/BitsizeUI';
import { ADMIN_META_CATEGORIES } from '../constants/adminConstants';
import { REPORT_ONLY_STATUSES } from '../constants/statusConstants';
import { isProtectedRetiredStatusMetaItem } from '../utils/metaUtils';
import { formatCreatedViaLabel } from '../utils/formatUtils';
import { metaDraftKey, useMetaManagement } from '../hooks/useMetaManagement';

/** How long "Saved" stays beside a row after a write lands. */
const SAVED_FLASH_MS = 2200;

/** Why a value cannot be edited, or null when it can. */
function lockReason(category, item) {
  if (category.readOnly) return 'Set by the app';
  if (isProtectedRetiredStatusMetaItem(category.key, item)) return 'Protected';
  return null;
}

/**
 * The label a lookup value is shown under, when it differs from what is stored.
 *
 * Submission sources are stored as machine tokens (`admin_backdated`) and read as
 * sentences everywhere else in the admin UI, so the row shows both — the sentence
 * in the field, the token beneath it.
 */
function displayNameFor(category, item) {
  if (category.key !== 'submissionSources') return null;
  return formatCreatedViaLabel(item.name);
}

/**
 * Which request types a value is offered on, when it is not all of them.
 *
 * Only the status list has a scope today: `submissions.status_id` points at one
 * table for every request type, and `statusesForRequestType` narrows what each
 * type may hold. Three of these values are the report-request vocabulary's own
 * words, so the row says so.
 */
function scopeNote(category, item) {
  if (category.key !== 'statuses') return null;
  const name = String(item?.name || '').trim().toLowerCase();
  if (REPORT_ONLY_STATUSES.some((status) => status.toLowerCase() === name)) {
    return 'Report requests only';
  }
  return null;
}

function pluralTickets(count) {
  return `ticket${count === 1 ? '' : 's'}`;
}

/** How many tickets hold this value. `md-use--zero` greys a count of nothing. */
function UsageCell({ count }) {
  return (
    <span className={`md-use${count === 0 ? ' md-use--zero' : ''}`}>
      <span className="md-use-n">{count}</span>
      <span className="md-use-w">{pluralTickets(count)}</span>
    </span>
  );
}

/**
 * Manage metadata.
 *
 * Every dropdown in the portal reads from one of these lists. The page is built
 * around the usage count: renaming a value renames it on every ticket that has it,
 * and switching one off keeps those tickets and only stops it being offered on new
 * ones — so the number of tickets using a value is the whole warning, stated in
 * place rather than in a dialog.
 *
 * Changes save as they are made: a rename commits on Enter or blur, a switch the
 * moment it is flipped. There is no per-row Save button, matching the Access page.
 */
export function AdminMetadataPage({ user }) {
  const navigate = useNavigate();
  const [notice, setNotice] = useState('');
  // Which row is showing its switch-off consequence, and which row just saved.
  // Both are held as a category-scoped key rather than a bare id: switching list
  // then makes them match nothing, so a half-answered prompt cannot reappear
  // against a different list's row that happens to share an id.
  const [confirmingKey, setConfirmingKey] = useState('');
  const [savedKey, setSavedKey] = useState('');
  const savedTimerRef = useRef(null);

  const {
    adminMetaOptions,
    adminMetaLoading,
    adminMetaSaving,
    adminMetaError,
    selectedMetaCategory,
    setSelectedMetaCategory,
    newMetaName,
    setNewMetaName,
    metaDraftNames,
    setMetaDraftNames,
    activeMetaCategoryConfig,
    activeMetaItems,
    loadAdminMeta,
    renameMetaItem,
    setMetaItemActive,
    addMetaItem,
    moveMetaItem,
  } = useMetaManagement({
    onNotice: setNotice,
    resetNoticeBeforeAction: true,
  });

  const category = activeMetaCategoryConfig;
  const isReadOnlyList = Boolean(category.readOnly);

  // ── Summary ────────────────────────────────────────────────────────────────
  // Orientation, not alarm: this page has no failure condition to escalate, so
  // the tiles state size and slack and leave it at that.
  const summary = useMemo(() => {
    let values = 0;
    let unused = 0;
    for (const meta of ADMIN_META_CATEGORIES) {
      const items = Array.isArray(adminMetaOptions?.[meta.optionsKey]) ? adminMetaOptions[meta.optionsKey] : [];
      values += items.length;
      unused += items.filter((item) => Number(item.usageCount || 0) === 0).length;
    }
    return { lists: ADMIN_META_CATEGORIES.length, values, unused };
  }, [adminMetaOptions]);

  /** Each list's size and how many of its values are switched off. */
  const railCounts = useMemo(() => {
    const counts = {};
    for (const meta of ADMIN_META_CATEGORIES) {
      const items = Array.isArray(adminMetaOptions?.[meta.optionsKey]) ? adminMetaOptions[meta.optionsKey] : [];
      counts[meta.key] = { total: items.length, off: items.filter((item) => !item.isActive).length };
    }
    return counts;
  }, [adminMetaOptions]);

  const listSummaryText = useCallback((meta) => {
    const counts = railCounts[meta.key] || { total: 0, off: 0 };
    const parts = [`${counts.total} value${counts.total === 1 ? '' : 's'}`];
    if (counts.off > 0) parts.push(`${counts.off} off`);
    if (meta.readOnly) parts.push('read-only');
    return parts.join(' · ');
  }, [railCounts]);

  // ── Saved flash ────────────────────────────────────────────────────────────

  useEffect(() => () => clearTimeout(savedTimerRef.current), []);

  const flashSaved = useCallback((key) => {
    clearTimeout(savedTimerRef.current);
    setSavedKey(key);
    savedTimerRef.current = setTimeout(() => setSavedKey(''), SAVED_FLASH_MS);
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  const draftFor = (item) => metaDraftNames[metaDraftKey(category.key, item.id)];

  const onNameChange = (item, value) => setMetaDraftNames((prev) => ({
    ...prev,
    [metaDraftKey(category.key, item.id)]: value,
  }));

  const revertName = (item) => setMetaDraftNames((prev) => {
    const next = { ...prev };
    delete next[metaDraftKey(category.key, item.id)];
    return next;
  });

  async function commitName(item) {
    const draft = draftFor(item);
    if (draft === undefined) return;
    if (!String(draft).trim() || String(draft).trim() === String(item.name || '').trim()) {
      revertName(item);
      return;
    }
    const key = metaDraftKey(category.key, item.id);
    if (await renameMetaItem(item, draft)) flashSaved(key);
  }

  /** Turning a value ON is additive; turning it OFF while tickets use it is the
   *  one place this page asks first. */
  async function onToggle(item) {
    const key = metaDraftKey(category.key, item.id);
    if (item.isActive && Number(item.usageCount || 0) > 0) {
      setConfirmingKey(key);
      return;
    }
    setConfirmingKey('');
    if (await setMetaItemActive(item, !item.isActive)) flashSaved(key);
  }

  async function confirmSwitchOff(item) {
    const key = metaDraftKey(category.key, item.id);
    setConfirmingKey('');
    if (await setMetaItemActive(item, false)) flashSaved(key);
  }

  async function onMove(item, direction) {
    const key = metaDraftKey(category.key, item.id);
    await moveMetaItem(item.id, direction);
    flashSaved(key);
  }

  // ── Pane ───────────────────────────────────────────────────────────────────

  const offCount = activeMetaItems.filter((item) => !item.isActive).length;
  const headCountParts = [`${activeMetaItems.length} value${activeMetaItems.length === 1 ? '' : 's'}`];
  if (offCount > 0) headCountParts.push(`${offCount} off`);
  if (isReadOnlyList) headCountParts.push('read-only');

  const canAdd = !isReadOnlyList && !adminMetaLoading && !adminMetaError;
  const busy = adminMetaLoading || adminMetaSaving;

  const tableHead = (
    <thead>
      <tr>
        <th scope="col">Value</th>
        <th scope="col" className="md-col-use">In use</th>
        <th scope="col" className="md-col-on">Offered on new tickets</th>
        <th scope="col" className="md-col-order">Order</th>
      </tr>
    </thead>
  );

  function renderPane() {
    if (adminMetaLoading && activeMetaItems.length === 0) {
      // Placeholders shaped like the real rows, so nothing jumps when data lands.
      return (
        <div className="md-tablewrap">
          <table className="md-table">
            {tableHead}
            <tbody>
              {[190, 130, 220, 160, 175, 145].map((width, index) => (
                <tr key={`skeleton-${index}`}>
                  <td><span className="md-skel" style={{ width }} /></td>
                  <td className="md-col-use"><span className="md-skel" style={{ width: 74 }} /></td>
                  <td className="md-col-on"><span className="md-skel" style={{ width: 38, height: 22, borderRadius: 999 }} /></td>
                  <td className="md-col-order"><span className="md-skel" style={{ width: 60, height: 28 }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    // An error with NOTHING to show is a failed load — there is no list to draw.
    // An error with rows still on screen is a refused save, and those rows (and
    // whatever the admin had typed into one of them) must stay put: the message
    // exists so they can correct it, which they cannot do if it took the field
    // away. It renders as a banner above the table instead.
    if (adminMetaError && activeMetaItems.length === 0) {
      return (
        <div className="md-state md-state--error">
          <h4>This list didn’t load</h4>
          <p>{adminMetaError} Nothing has been changed — every value is as it was.</p>
          <Button type="button" onClick={loadAdminMeta} disabled={adminMetaLoading}>Try again</Button>
        </div>
      );
    }

    if (activeMetaItems.length === 0) {
      return (
        <div className="md-state">
          <h4>No values yet</h4>
          <p>Add the first one above and it becomes selectable everywhere this list is offered.</p>
        </div>
      );
    }

    return (
      <div className="md-tablewrap">
        <table className="md-table">
          {tableHead}
          <tbody>
            {activeMetaItems.map((item, index) => {
              const key = metaDraftKey(category.key, item.id);
              const locked = lockReason(category, item);
              const display = displayNameFor(category, item);
              const draft = draftFor(item);
              const usageCount = Number(item.usageCount || 0);
              const shownValue = display ?? (draft !== undefined ? draft : String(item.name || ''));
              const isDirty = draft !== undefined && String(draft) !== String(item.name || '');

              return (
                <Fragment key={item.id}>
                  <tr className={`${item.isActive ? '' : 'md-row--off '}${locked ? 'md-row--locked' : ''}`}>
                    <td>
                      <span className="md-namecell">
                        <input
                          className="md-name-input"
                          value={shownValue}
                          // Not disabled while a save is in flight: an admin who
                          // tabs straight to the next row and types must not lose
                          // the keystrokes, and an unsaved draft now survives the
                          // reload that follows every write.
                          disabled={Boolean(locked)}
                          aria-label={`Name of ${item.name}`}
                          onChange={(event) => onNameChange(item, event.target.value)}
                          onBlur={() => commitName(item)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              commitName(item);
                            }
                            if (event.key === 'Escape') revertName(item);
                          }}
                        />
                        {display && <span className="md-name-raw">{item.name}</span>}
                        {locked && <span className="md-name-lock">{locked}</span>}
                        {/* One status table serves every request type, and three
                            of its values belong to report requests alone. Said on
                            the row because otherwise the list gives an admin no
                            way to know which dropdown a value appears in. */}
                        {scopeNote(category, item) && (
                          <span className="md-name-lock">{scopeNote(category, item)}</span>
                        )}
                        {isDirty && (
                          <span className="md-name-dirty">Press Enter to rename · Esc to undo</span>
                        )}
                      </span>
                    </td>
                    <td className="md-col-use"><UsageCell count={usageCount} /></td>
                    <td className="md-col-on">
                      <span className="md-switchcell">
                        <label className="md-switch">
                          <input
                            type="checkbox"
                            checked={Boolean(item.isActive)}
                            disabled={Boolean(locked) || busy}
                            aria-label={`Offer ${item.name} on new tickets`}
                            onChange={() => onToggle(item)}
                          />
                          <span className="md-track" />
                        </label>
                        <span className={`md-switch-txt${item.isActive ? ' md-switch-txt--on' : ''}`}>
                          {item.isActive ? 'Offered' : 'Not offered'}
                        </span>
                        {savedKey === key && <span className="md-saved">Saved</span>}
                      </span>
                    </td>
                    <td className="md-col-order">
                      <span className="md-orderbtns">
                        <button
                          type="button"
                          className="md-obtn"
                          disabled={Boolean(locked) || busy || index === 0}
                          aria-label={`Move ${item.name} up`}
                          onClick={() => onMove(item, 'up')}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="md-obtn"
                          disabled={Boolean(locked) || busy || index === activeMetaItems.length - 1}
                          aria-label={`Move ${item.name} down`}
                          onClick={() => onMove(item, 'down')}
                        >
                          ↓
                        </button>
                      </span>
                    </td>
                  </tr>
                  {confirmingKey === key && (
                    <tr className="md-consequence">
                      <td colSpan={4}>
                        <span className="md-consequence-in">
                          <p>
                            <b>{usageCount} {pluralTickets(usageCount)}</b>{' '}
                            {usageCount === 1 ? 'uses' : 'use'} “{item.name}”.{' '}
                            {usageCount === 1 ? 'It keeps it' : 'They keep it'} — switching off only
                            stops it being offered on new tickets.
                          </p>
                          <button
                            type="button"
                            className="md-cbtn md-cbtn--go"
                            disabled={busy}
                            onClick={() => confirmSwitchOff(item)}
                          >
                            Switch it off
                          </button>
                          <button
                            type="button"
                            className="md-cbtn"
                            onClick={() => setConfirmingKey('')}
                          >
                            Keep offering it
                          </button>
                        </span>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const refreshButton = (
    <Button kind="ghost" onClick={loadAdminMeta} disabled={busy}>
      {adminMetaLoading ? 'Refreshing…' : 'Refresh'}
    </Button>
  );

  return (
    <div className="md-page">
      <div className="bs-header">
        <div>
          <h2>Metadata</h2>
          <p>
            Every dropdown in the portal reads from a list here. Renaming a value renames it
            everywhere it already appears; switching one off keeps the tickets that use it and only
            stops it being offered on new ones.
          </p>
        </div>
        <div className="bs-actions">
          <Button kind="ghost" onClick={() => navigate('/admin')}>Back to Admin Queue</Button>
        </div>
      </div>

      {notice && <Notice text={notice} kind="success" />}

      <div className="md-tiles">
        <div className="md-tile">
          <span className="md-tile-num">{summary.lists}</span>
          <span className="md-tile-lbl">Lists</span>
        </div>
        <div className="md-tile">
          <span className="md-tile-num">{summary.values}</span>
          <span className="md-tile-lbl">Values across them</span>
        </div>
        <div className="md-tile">
          <span className="md-tile-num">{summary.unused}</span>
          <span className="md-tile-lbl">Values no ticket uses</span>
        </div>
      </div>

      <section className="bs-card md-card">
        {/* Narrow screens only; the rail below covers wide ones. Same state, one
            selection — this is not a second source of truth. */}
        <div className="md-picker">
          <label className="md-picker-lbl" htmlFor="md-list-pick">List</label>
          <select
            className="md-picker-select"
            id="md-list-pick"
            aria-label="Metadata list"
            value={selectedMetaCategory}
            onChange={(event) => setSelectedMetaCategory(event.target.value)}
          >
            {ADMIN_META_CATEGORIES.map((meta) => (
              <option key={meta.key} value={meta.key}>
                {meta.label} — {listSummaryText(meta)}
              </option>
            ))}
          </select>
          {refreshButton}
        </div>

        <div className="md-body">
          <nav className="md-rail" aria-label="Metadata lists">
            <p className="md-rail-lbl">Lists</p>
            {ADMIN_META_CATEGORIES.map((meta) => {
              const isActive = meta.key === selectedMetaCategory;
              return (
                <button
                  key={meta.key}
                  type="button"
                  className={`md-railitem${isActive ? ' md-railitem--on' : ''}`}
                  aria-current={isActive ? 'true' : 'false'}
                  onClick={() => setSelectedMetaCategory(meta.key)}
                >
                  <span className="md-railitem-name">{meta.label}</span>
                  <span className="md-railitem-sub">{listSummaryText(meta)}</span>
                </button>
              );
            })}
            <div className="md-rail-sep" />
            <div className="md-rail-foot">{refreshButton}</div>
          </nav>

          <div className="md-list">
            <div className="md-listhead">
              <span className="md-listtitle">
                <h3>{category.label}</h3>
                <span className="md-headcount">{headCountParts.join(' · ')}</span>
              </span>
              <p className="md-feeds">{category.feeds}</p>
              {isReadOnlyList ? (
                <p className="md-feeds" style={{ marginTop: 8 }}>🔒 {category.readOnly}</p>
              ) : (
                <span className="md-addrow">
                  <input
                    className="md-input"
                    placeholder={`Add a value to ${category.label.toLowerCase()}`}
                    aria-label="New value name"
                    value={newMetaName}
                    disabled={!canAdd || adminMetaSaving}
                    onChange={(event) => setNewMetaName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && String(newMetaName || '').trim()) {
                        event.preventDefault();
                        addMetaItem();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    disabled={!canAdd || adminMetaSaving || !String(newMetaName || '').trim()}
                    onClick={addMetaItem}
                  >
                    Add
                  </Button>
                  <p className="md-addhint">
                    It goes to the bottom of the list and is offered straight away.
                  </p>
                </span>
              )}
            </div>

            {adminMetaError && activeMetaItems.length > 0 && (
              <div style={{ padding: '12px 18px 0' }}>
                <Notice text={adminMetaError} />
              </div>
            )}

            {renderPane()}

            <div className="md-listfoot">
              <strong>Changes save as you make them.</strong> A rename commits on Enter, a switch the
              moment you flip it. Values are never deleted — switching one off is how you stop
              offering it.{category.note ? ` ${category.note}` : ''}
            </div>
          </div>
        </div>
      </section>

      <p className="md-signedin">Signed in as <strong>{user.username}</strong></p>
    </div>
  );
}
