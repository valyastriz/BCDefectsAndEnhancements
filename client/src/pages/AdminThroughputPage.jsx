import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Notice } from '../components/bite-size/BitsizeUI';
import { THROUGHPUT_RANGES, useThroughput } from '../hooks/useThroughput';

/** Hours as a number a person reads: 71.5, not 71.50 and not 71.499999. */
function formatHours(value) {
  const hours = Math.round(Number(value || 0) * 100) / 100;
  return String(hours);
}

/**
 * 'Aug' for a 'YYYY-MM' from the server, with the year added only when the window
 * straddles two of them — a bare 'Jan' after a 'Dec' reads as the wrong January.
 */
function monthLabel(month, showYear) {
  const [year, index] = String(month || '').split('-');
  const date = new Date(Number(year), Number(index) - 1, 1);
  if (!Number.isFinite(date.getTime())) return String(month || '');
  const short = date.toLocaleString(undefined, { month: 'short' });
  return showYear ? `${short} ${String(year).slice(2)}` : short;
}

/**
 * The top of a column chart's axis.
 *
 * Rounded up to something a gridline can be labelled with, and never zero — the
 * bar heights are percentages of this number.
 */
function axisTop(max, unit) {
  if (unit === 'h') return Math.max(10, Math.ceil(max / 10) * 10);
  return Math.max(2, Math.ceil(max / 2) * 2);
}

function ChartCard({ title, sub, children }) {
  return (
    <section className="tp-card">
      <div className="tp-cardhead">
        <h3>{title}</h3>
        <p>{sub}</p>
      </div>
      {children}
    </section>
  );
}

/** Why a card has nothing to draw. Two reasons need two answers, so it says which. */
function EmptyCard({ title, body }) {
  return (
    <div className="tp-empty">
      <span className="tp-empty-icon" aria-hidden="true">&#10022;</span>
      <h4>{title}</h4>
      <p>{body}</p>
    </div>
  );
}

/**
 * Horizontal bars, one or two series.
 *
 * No gridlines and no value axis: every bar carries its own number at the tip,
 * and a direct label beats an axis a reader has to trace back to. Rows arrive
 * pre-sorted — the order is the chart's own statement, not this component's.
 */
function BarRows({ rows, max }) {
  return (
    <ul className="tp-bars">
      {rows.map((row) => {
        const tip = {};
        row.series.forEach((series, index) => {
          tip[`data-tip-${index + 1}`] = `${series.tipValue}|${series.tipLabel}`;
        });
        return (
          <li key={row.key}>
            {/* The hit target is the whole row, which is taller than the bar, and
                keyboard focus shows exactly what hover shows. */}
            <div className="tp-row" tabIndex={0} role="group" data-tip={row.name} {...tip}>
              <span className="tp-name">{row.name}</span>
              <span className="tp-track">
                {row.series.map((series, index) => (
                  <span className="tp-bar" key={series.tipLabel}>
                    <span className="tp-plot">
                      {/* `data-value` is the bar's own claim, so the browser check
                          can measure the drawn width against it rather than
                          against a number hard-coded in a test. */}
                      <span
                        className={`tp-fill tp-fill--${index + 1}`}
                        data-value={series.value}
                        style={{ width: `${max > 0 ? (series.value / max) * 100 : 0}%` }}
                      />
                    </span>
                    <span className="tp-val">{series.display}</span>
                  </span>
                ))}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Columns over months. Only the latest is labelled on its cap; the axis carries
 * the rest.
 *
 * `data-value` on each column is what `CHART_SCALE_PROBE` measures the drawn bar
 * against — the chart is checked against its own claim rather than against
 * numbers hard-coded in a test.
 */
function ColumnChart({ points, unit }) {
  const max = points.reduce((largest, point) => Math.max(largest, point.value), 0);
  const top = axisTop(max, unit);
  const showYear = new Set(points.map((point) => String(point.month).slice(0, 4))).size > 1;
  const last = points.length - 1;

  return (
    <div className="tp-cols">
      <span className="tp-grid" aria-hidden="true">
        {[0, top / 2, top].map((value) => (
          <span key={value} className="tp-gridline" style={{ bottom: `${(value / top) * 100}%` }}>
            <span className="tp-gridlabel">{formatHours(value)}</span>
          </span>
        ))}
      </span>
      {points.map((point, index) => {
        const display = unit === 'h' ? formatHours(point.value) : String(point.value);
        return (
          <button
            type="button"
            className="tp-col"
            key={point.month}
            data-value={point.value}
            data-tip={monthLabel(point.month, showYear)}
            data-tip-1={`${display}${unit === 'h' ? ' h' : ''}|${unit === 'h' ? 'logged' : 'delivered'}`}
          >
            <span className="tp-colplot">
              <span className="tp-colfill" style={{ height: `${(point.value / top) * 100}%` }}>
                {index === last && <span className="tp-colval">{display}</span>}
              </span>
            </span>
            <span className="tp-collabel">{monthLabel(point.month, showYear)}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The table twin, drawn closed.
 *
 * Every value in every chart above is in here, so nothing on this page is
 * reachable only by hovering — which is also the only way the numbers are usable
 * on a touch screen.
 */
function TableTwin({ open, onToggle, children }) {
  return (
    <>
      <button
        type="button"
        className="tp-table-toggle"
        aria-expanded={open}
        aria-controls="tp-table"
        onClick={onToggle}
      >
        {open ? 'Hide the numbers' : 'Show the numbers'}
        <span className="dm-caret" aria-hidden="true" />
      </button>
      {open && <div id="tp-table">{children}</div>}
    </>
  );
}

/** One tile row, shared with the Metadata and Access pages. */
function Tiles({ cells }) {
  return (
    <div className="md-tiles">
      {cells.map((cell) => (
        <div className="md-tile" key={cell.label}>
          <span className="md-tile-num">{cell.value}</span>
          <span className="md-tile-lbl">{cell.label}</span>
        </div>
      ))}
    </div>
  );
}

const NO_TIP = { open: false, left: 0, top: 0, above: true, category: '', rows: [] };

/** The tooltip's own width, so it can be kept inside the window without measuring. */
const TIP_MAX_WIDTH = 260;

/** What a mark says about itself, read off the same data attributes the mockup used. */
function readTip(element) {
  const category = element.getAttribute('data-tip');
  if (!category) return null;
  const rows = [];
  for (const slot of [1, 2]) {
    const raw = element.getAttribute(`data-tip-${slot}`);
    if (!raw) continue;
    const [value, label = ''] = raw.split('|');
    rows.push({ slot, value, label });
  }
  return { category, rows };
}

/**
 * Reporting throughput.
 *
 * TWO VIEWS, and the SERVER picks. `GET /api/admin/throughput` reads the caller's
 * own rank and narrows the query: a non-manager's response contains their numbers
 * and nobody else's, so there is nothing here to filter and no colleague's name in
 * the browser to leak. `scope` on the response names the view; this page draws it.
 *
 * The analyst's view is a DIFFERENT COMPOSITION rather than the manager's page
 * with rows hidden — one person's "worked on" and "closed" are two numbers, and a
 * two-bar bar chart is the wrong form for two numbers, so they become tiles.
 *
 * Deliberately not live-updating. Every other surface in the portal is; a
 * dashboard that reshuffles while it is being read is worse than one that is a
 * minute old, so this one states when it was built and offers a refresh.
 */
export function AdminThroughputPage() {
  const navigate = useNavigate();
  const {
    range,
    setRange,
    applicationId,
    setApplicationId,
    applications,
    canScopeToAll,
    data,
    isTeamView,
    loading,
    error,
    reload,
  } = useThroughput();

  const [tableOpen, setTableOpen] = useState(false);
  const [tip, setTip] = useState(NO_TIP);

  // Placed above the pointer, unless that would put it off the top of the window.
  // Clamped against TIP_MAX_WIDTH rather than the box's measured width, because
  // measuring before the new content has rendered gives the previous size.
  const showTipFor = useCallback((element, x, y) => {
    const read = readTip(element);
    if (!read) return setTip(NO_TIP);
    return setTip({
      open: true,
      left: Math.max(8, Math.min(x + 14, window.innerWidth - TIP_MAX_WIDTH - 14)),
      top: y > 140 ? y - 12 : y + 20,
      above: y > 140,
      category: read.category,
      rows: read.rows,
    });
  }, []);

  const onPointerMove = useCallback((event) => {
    const mark = event.target.closest?.('[data-tip]');
    if (mark) showTipFor(mark, event.clientX, event.clientY);
    else setTip(NO_TIP);
  }, [showTipFor]);

  const onFocus = useCallback((event) => {
    const mark = event.target.closest?.('[data-tip]');
    if (!mark) return setTip(NO_TIP);
    const box = mark.getBoundingClientRect();
    return showTipFor(mark, box.left + box.width / 2, box.top + box.height / 2);
  }, [showTipFor]);

  const hideTip = useCallback(() => setTip(NO_TIP), []);

  // Always arrays — useThroughput normalises them, so nothing here needs a
  // fallback that would also make every memo below re-run on every render.
  const { analysts, by_month: byMonth, hours_by_month: hoursByMonth } = data;

  // The person's own row, for the personal view. Absent until they have logged
  // something, which is a zero rather than a missing page.
  const mine = analysts[0] || { hours: 0, worked: 0, closed: 0 };

  const builtAt = useMemo(() => {
    const stamp = Date.parse(data.built_at || '');
    if (!Number.isFinite(stamp)) return '';
    return new Date(stamp).toLocaleString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }, [data.built_at]);

  const hoursRows = useMemo(() => (
    [...analysts]
      .sort((left, right) => right.hours - left.hours)
      .map((analyst) => ({
        key: analyst.user_id,
        name: analyst.name,
        series: [{
          value: analyst.hours,
          display: <>{formatHours(analyst.hours)} <small>h</small></>,
          tipValue: `${formatHours(analyst.hours)} h`,
          tipLabel: 'logged',
        }],
      }))
  ), [analysts]);

  const creditRows = useMemo(() => (
    [...analysts]
      .sort((left, right) => right.worked - left.worked)
      .map((analyst) => ({
        key: analyst.user_id,
        name: analyst.name,
        series: [
          {
            value: analyst.worked, display: String(analyst.worked), tipValue: analyst.worked, tipLabel: 'worked on',
          },
          {
            value: analyst.closed, display: String(analyst.closed), tipValue: analyst.closed, tipLabel: 'closed',
          },
        ],
      }))
  ), [analysts]);

  // Every month either series knows about, so the personal table cannot drop a
  // month that has hours but no completion (or the other way round).
  const personalMonths = useMemo(() => {
    const closedBy = new Map(byMonth.map((row) => [row.month, row.count]));
    const hoursBy = new Map(hoursByMonth.map((row) => [row.month, row.hours]));
    return [...new Set([...hoursBy.keys(), ...closedBy.keys()])]
      .sort()
      .map((month) => ({ month, hours: hoursBy.get(month) || 0, closed: closedBy.get(month) || 0 }));
  }, [byMonth, hoursByMonth]);

  const teamTotals = useMemo(() => ({
    worked: analysts.reduce((sum, analyst) => sum + analyst.worked, 0),
    closed: analysts.reduce((sum, analyst) => sum + analyst.closed, 0),
  }), [analysts]);

  const header = (
    <div className="bs-header">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <h2>{isTeamView ? 'Reporting throughput' : 'Your reporting work'}</h2>
        <p>
          {isTeamView
            ? 'What the reporting analysts got through, and who did the work. Report requests only — defects and enhancements are not counted here.'
            : 'What you got through on report requests. Defects and enhancements are not counted here.'}
        </p>
      </div>
      <div className="bs-actions">
        <Button kind="ghost" onClick={reload} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
        <Button kind="ghost" onClick={() => navigate('/admin')}>Back to Admin Queue</Button>
      </div>
    </div>
  );

  const filters = (
    <div className="tp-filters">
      <div className="tp-filter">
        <span>Timeframe</span>
        {/* Both controls are always in the DOM and always in step; CSS picks one,
            so a phone gets a select and a desktop the pill group. */}
        <div className="tp-range" role="group" aria-label="Timeframe">
          {THROUGHPUT_RANGES.map((option) => (
            <button
              type="button"
              key={option.key}
              aria-pressed={range === option.key}
              onClick={() => setRange(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <select
          className="tp-scope tp-rangeselect"
          aria-label="Timeframe"
          value={range}
          onChange={(event) => setRange(event.target.value)}
        >
          {THROUGHPUT_RANGES.map((option) => (
            <option key={option.key} value={option.key}>{option.label}</option>
          ))}
        </select>
      </div>
      <div className="tp-filter">
        <span>Application</span>
        <select
          className="tp-scope"
          aria-label="Application"
          value={applicationId}
          onChange={(event) => setApplicationId(event.target.value)}
        >
          {/* "All applications" is offered only to someone who manages every
              application they can read — otherwise the page would have to be two
              shapes at once, and the server would answer with one of them. */}
          {canScopeToAll && <option value="">All applications</option>}
          {applications.map((application) => (
            <option key={application.id} value={String(application.id)}>{application.name}</option>
          ))}
        </select>
      </div>
      {builtAt && <p className="tp-asof">Built {builtAt}</p>}
    </div>
  );

  if (error && !data.built_at) {
    return (
      <div className="tp-page">
        {header}
        <section className="tp-card">
          <div className="tp-empty">
            <span className="tp-empty-icon" aria-hidden="true">&#10022;</span>
            <h4>The numbers didn&apos;t load</h4>
            <p>{error} Nothing has been changed — this page only reads.</p>
            <Button kind="primary" onClick={reload}>Try again</Button>
          </div>
        </section>
      </div>
    );
  }

  if (loading && !data.built_at) {
    return (
      <div className="tp-page">
        {header}
        <div className="md-tiles" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => <div className="tp-skel tp-skel-tile" key={index} />)}
        </div>
        <div className="tp-charts" aria-hidden="true">
          {[0, 1, 2].map((index) => <div className="tp-skel tp-skel-card" key={index} />)}
        </div>
        <p className="muted">Counting up the window…</p>
      </div>
    );
  }

  const teamBody = (
    <>
      <Tiles
        cells={[
          { value: data.delivered, label: 'Requests delivered' },
          { value: `${formatHours(data.total_hours)} h`, label: 'Hours logged' },
          {
            value: analysts.length,
            label: analysts.length === 1 ? 'Analyst logged time' : 'Analysts logged time',
          },
          {
            value: data.median_days == null ? '—' : `${data.median_days} days`,
            label: 'Median, reported to delivered',
          },
        ]}
      />

      <div className="tp-note">
        <span className="tp-note-glyph" aria-hidden="true">&#9432;</span>
        <b>Two of these numbers answer different questions.</b>
        <span>
          An analyst is credited with a request they <b>worked on</b> if they logged hours against
          it. <b>Closed</b> counts who held it at the finish. Reassignment means those are rarely
          the same list, and only the first of them survives a hand-over.
        </span>
      </div>

      <div className="tp-charts">
        <ChartCard
          title="Hours by analyst"
          sub="Time logged in this window, by the day it was worked."
        >
          {hoursRows.length === 0
            ? (
              <EmptyCard
                title="No hours in this window"
                body="Nothing was logged between these dates. Widen the timeframe to see earlier work."
              />
            )
            : <BarRows rows={hoursRows} max={hoursRows[0].series[0].value} />}
        </ChartCard>

        <ChartCard
          title="Requests worked on, and requests closed"
          sub="Worked on counts delivered requests they logged hours against. Closed counts the ones they held at the finish. The two are not the same question."
        >
          {creditRows.length === 0
            ? (
              <EmptyCard
                title="Nothing was delivered in this window"
                body="A request counts here on the day it is marked delivered, not the day it was raised."
              />
            )
            : (
              <>
                {/* Two series, so a legend — identity is never colour alone. */}
                <div className="tp-legend">
                  <span className="tp-legend-item"><span className="tp-key tp-key--1" />Worked on</span>
                  <span className="tp-legend-item"><span className="tp-key tp-key--2" />Closed</span>
                </div>
                <BarRows
                  rows={creditRows}
                  max={creditRows.reduce(
                    (largest, row) => Math.max(largest, row.series[0].value, row.series[1].value),
                    0,
                  )}
                />
              </>
            )}
        </ChartCard>

        <ChartCard title="Delivered by month" sub="Requests reaching their completion date.">
          {byMonth.length === 0
            ? (
              <EmptyCard
                title="Nothing delivered yet"
                body="Months appear here as requests are marked delivered on the Delivery tab."
              />
            )
            : (
              <ColumnChart
                points={byMonth.map((row) => ({ month: row.month, value: row.count }))}
                unit="n"
              />
            )}
        </ChartCard>
      </div>

      <TableTwin open={tableOpen} onToggle={() => setTableOpen((prev) => !prev)}>
        <div className="tp-tablewrap">
          <table className="tp-table">
            <thead>
              <tr>
                <th scope="col">Analyst</th>
                <th scope="col">Hours</th>
                <th scope="col">Worked on</th>
                <th scope="col">Closed</th>
              </tr>
            </thead>
            <tbody>
              {hoursRows.length === 0 && (
                <tr><td colSpan={4}>Nobody logged time in this window.</td></tr>
              )}
              {[...analysts].sort((left, right) => right.hours - left.hours).map((analyst) => (
                <tr key={analyst.user_id}>
                  <td>{analyst.name}</td>
                  <td>{formatHours(analyst.hours)}</td>
                  <td>{analyst.worked}</td>
                  <td>{analyst.closed}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{analysts.length} analyst{analysts.length === 1 ? '' : 's'}</td>
                <td>{formatHours(data.total_hours)}</td>
                <td>{teamTotals.worked}</td>
                <td>{teamTotals.closed}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </TableTwin>
    </>
  );

  const personalBody = (
    <>
      <Tiles
        cells={[
          { value: mine.worked, label: 'Requests you worked on' },
          { value: data.delivered, label: 'Requests you closed' },
          { value: `${formatHours(data.total_hours)} h`, label: 'Hours you logged' },
          {
            value: data.median_days == null ? '—' : `${data.median_days} days`,
            label: 'Median, reported to delivered',
          },
        ]}
      />

      <div className="tp-note">
        <span className="tp-note-glyph" aria-hidden="true">&#9432;</span>
        <b>These are your numbers.</b>
        <span>
          Everyone who works report requests can see their own. The team&rsquo;s figures, and who
          did what, are visible to reporting managers on this application.
        </span>
      </div>

      <div className="tp-charts">
        <ChartCard title="Your hours" sub="Time you logged, by the day you worked it.">
          {hoursByMonth.length === 0
            ? (
              <EmptyCard
                title="Nothing in this window"
                body="Months appear here as work is logged and requests are marked delivered."
              />
            )
            : (
              <ColumnChart
                points={hoursByMonth.map((row) => ({ month: row.month, value: row.hours }))}
                unit="h"
              />
            )}
        </ChartCard>

        <ChartCard
          title="Requests you closed"
          sub="Requests reaching their completion date with you holding them."
        >
          {byMonth.length === 0
            ? (
              <EmptyCard
                title="Nothing in this window"
                body="Months appear here as work is logged and requests are marked delivered."
              />
            )
            : (
              <ColumnChart
                points={byMonth.map((row) => ({ month: row.month, value: row.count }))}
                unit="n"
              />
            )}
        </ChartCard>
      </div>

      <TableTwin open={tableOpen} onToggle={() => setTableOpen((prev) => !prev)}>
        <div className="tp-tablewrap">
          <table className="tp-table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Hours</th>
                <th scope="col">Closed</th>
              </tr>
            </thead>
            <tbody>
              {personalMonths.length === 0 && (
                <tr><td colSpan={3}>Nothing to count in this window.</td></tr>
              )}
              {personalMonths.map((row) => (
                <tr key={row.month}>
                  <td>{monthLabel(row.month, true)}</td>
                  <td>{formatHours(row.hours)}</td>
                  <td>{row.closed}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td>{formatHours(data.total_hours)}</td>
                <td>{data.delivered}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </TableTwin>
    </>
  );

  return (
    <div
      className="tp-page"
      onPointerMove={onPointerMove}
      onPointerLeave={hideTip}
      onFocus={onFocus}
      onBlur={hideTip}
    >
      {header}
      {error && <Notice text={`${error} The numbers below are from the last successful load.`} />}
      {filters}
      {isTeamView ? teamBody : personalBody}

      {/* Enhances, never gates: every number in here is also a direct label or a
          row in the table above. Positioned above the pointer unless that would
          put it off the top of the window. */}
      <div
        className="tp-tip"
        role="status"
        aria-live="polite"
        data-open={tip.open ? 'true' : 'false'}
        style={{
          left: `${tip.left}px`,
          top: `${tip.top}px`,
          transform: tip.above ? 'translateY(-100%)' : 'none',
        }}
      >
        {tip.open && (
          <>
            <span className="tp-tip-cat">{tip.category}</span>
            {tip.rows.map((row) => (
              <span className="tp-tip-row" key={row.slot}>
                <span
                  className="tp-tip-key"
                  style={{ background: `var(--chart-${row.slot})` }}
                />
                <span className="tp-tip-val">{row.value}</span>
                <span className="tp-tip-lbl">{row.label}</span>
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
