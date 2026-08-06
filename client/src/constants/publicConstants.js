/**
 * Public status board constants.
 */

import { TRACKER_LABEL } from './tracker';

export const PUBLIC_STATUSES = [
  'New',
  'Approved',
  'Redirected',
  'Backlog - Monitoring Impact',
  'Future Consideration',
  'Deferred – Not in Current Scope',
  'Rejected',
  'Duplicate',
  'Submitted',
  'Deployed',
];

export const PUBLIC_FILTERS_STORAGE_KEY = 'bc.public.filters';
export const PUBLIC_RETIRED_FILTER_STORAGE_KEY = 'bc.public.retiredFilter';

// The application-scope value meaning "every application". The live filter uses
// '' for that, but the picker needs a value it can select.
export const ALL_APPLICATIONS = '__all__';

// ── The pipeline, as the board draws it ─────────────────────────────────────
// Four stops in order, each covering the statuses that put a ticket there.
// Everything not named here is a closed outcome — the trailing tile and the
// Stage filter's last option both mean "anything else", so the numbers always
// sum to the total rather than quietly losing tickets.
//
// The last two stops cover TWO WORDS EACH, because a report request travels the
// same four positions under its own vocabulary: it is built in the portal rather
// than handed to the Service Desk, so it goes In progress and then Delivered
// where a defect goes to the Service Desk and then Deployed. Both words are on
// the tile because the tile counts both types — the per-ticket track in
// StatusBoardRow names only the one that ticket actually travels.
export const PUBLIC_STAGES = [
  { key: 'reported', label: 'Reported', statuses: ['New'], modifier: 'pb-tile--reported' },
  { key: 'approved', label: 'Approved', statuses: ['Approved'], modifier: 'pb-tile--approved' },
  {
    key: 'submitted',
    label: `With ${TRACKER_LABEL} / In progress`,
    statuses: ['Submitted', 'In progress'],
    modifier: 'pb-tile--submitted',
  },
  {
    key: 'deployed',
    label: 'Deployed / Delivered',
    statuses: ['Deployed', 'Delivered'],
    modifier: 'pb-tile--deployed',
  },
];

export const STAGED_STATUSES = new Set(PUBLIC_STAGES.flatMap((stage) => stage.statuses));

// ── Sort registry (drives the sort control and the column headers) ──────────
// Keys index PUBLIC_SORT_COLS. Only fields the public payload actually carries
// appear here — the allow-list is PUBLIC_SUBMISSION_FIELDS in
// server/src/helpers/mappers.js, and a sort field outside it could not be
// computed on this surface.
//
// `statusUpdate` and `reportedDate` keep the exact stored values the board has
// always written ('updated_desc', 'created_asc', …) so a saved sort survives.
export const PUBLIC_SORT_COLS = {
  statusUpdate: { asc: 'updated_asc', desc: 'updated_desc' },
  reportedDate: { asc: 'created_asc', desc: 'created_desc' },
  id: { asc: 'id_asc', desc: 'id_desc' },
  summary: { asc: 'summary_asc', desc: 'summary_desc' },
  status: { asc: 'status_asc', desc: 'status_desc' },
  type: { asc: 'type_asc', desc: 'type_desc' },
  createdBy: { asc: 'created_by_asc', desc: 'created_by_desc' },
  easyvista: { asc: 'easyvista_asc', desc: 'easyvista_desc' },
  application: { asc: 'application_asc', desc: 'application_desc' },
};

export const PUBLIC_SORT_FIELDS = [
  { key: 'statusUpdate', label: 'Last status update', type: 'date' },
  { key: 'reportedDate', label: 'Reported date', type: 'date' },
  { key: 'id', label: 'Ticket number', type: 'number' },
  { key: 'summary', label: 'Summary', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'type', label: 'Type', type: 'text' },
  { key: 'createdBy', label: 'Reported by', type: 'text' },
  { key: 'easyvista', label: 'Incident #', type: 'text' },
  { key: 'application', label: 'Application', type: 'text' },
];

export const DEFAULT_PUBLIC_SORT = PUBLIC_SORT_COLS.statusUpdate.desc;

// The columns the board draws, in order, with the sort key each header writes
// (null = not sortable). `area` is the CSS grid area the cell occupies, so the
// header and the row cells drop out together at a breakpoint.
export const PUBLIC_BOARD_COLUMNS = [
  { key: 'ref', label: 'Ticket', sortKey: 'id' },
  { key: 'type', label: 'Type', sortKey: 'type' },
  { key: 'sum', label: 'Summary', sortKey: 'summary' },
  { key: 'stage', label: 'Stage', sortKey: 'status' },
  { key: 'who', label: 'Reported by', sortKey: 'createdBy' },
  { key: 'app', label: 'Application', sortKey: 'application' },
  { key: 'when', label: 'Updated', sortKey: 'statusUpdate' },
];

// ── Filter registry ─────────────────────────────────────────────────────────
// Keys match the fields in buildDefaultPublicFilters(). The labels are what the
// chips print, so they read as a sentence: "Reported by: r.okafor".
export const PUBLIC_FILTER_FIELDS = [
  { key: 'search', label: 'Search' },
  { key: 'typeFilter', label: 'Type' },
  { key: 'statuses', label: 'Status' },
  { key: 'year', label: 'Reported in' },
  { key: 'easyvistaNumber', label: 'Incident #' },
  { key: 'jiraNumber', label: 'JIRA #' },
  { key: 'referenceNumber', label: 'Policy / Account #' },
  { key: 'createdBy', label: 'Reported by' },
  { key: 'application', label: 'Application' },
];

// The grouped panel, mirroring ADMIN_FILTER_GROUPS. `stage` is not a filter of
// its own — it reads and writes `statuses`, exactly as the tiles do — so it is
// listed here for placement but never chipped.
export const PUBLIC_FILTER_GROUPS = [
  { key: 'ticket', label: 'Ticket', filterKeys: ['typeFilter', 'statuses', 'year'] },
  { key: 'standing', label: 'Where it stands', filterKeys: ['stage', 'retiredFilter'] },
  { key: 'refs', label: 'Reference numbers', filterKeys: ['easyvistaNumber', 'jiraNumber', 'referenceNumber'] },
  { key: 'people', label: 'People', filterKeys: ['createdBy', 'application'] },
];
