const API_BASE = import.meta.env.VITE_API_BASE || '';

const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function readCsrfToken() {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)bc_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function buildAdminSubmissionsQuery({
  status = '',
  statuses = [],
  type = '',
  types = [],
  cleanupRequired = '',
  cleanupStatuses = [],
  search = '',
  requester = '',
  submittedBy = '',
  createdVia = '',
  application = '',
  retiredFilter = 'non_retired',
  year = '',
  inJira = '',
  workaround = '',
  jiraNumber = '',
  easyvistaNumber = '',
  releaseNumber = '',
  sort = 'updated_desc',
  fields = [],
} = {}) {
  const params = new URLSearchParams();
  if (Array.isArray(statuses) && statuses.length > 0) {
    params.set('statuses', statuses.join(','));
  } else if (status) {
    params.set('status', status);
  }
  if (type) params.set('type', type);
  if (Array.isArray(types) && types.length > 0) params.set('types', types.join(','));
  if (cleanupRequired) params.set('cleanupRequired', cleanupRequired);
  if (Array.isArray(cleanupStatuses) && cleanupStatuses.length > 0) params.set('cleanupStatuses', cleanupStatuses.join(','));
  if (search) params.set('search', search);
  if (requester) params.set('requester', requester);
  if (submittedBy) params.set('submittedBy', submittedBy);
  if (createdVia) params.set('createdVia', createdVia);
  if (application) params.set('application', application);
  if (retiredFilter) params.set('retiredFilter', retiredFilter);
  if (year) params.set('year', year);
  if (inJira) params.set('inJira', inJira);
  if (workaround) params.set('workaround', workaround);
  if (jiraNumber) params.set('jiraNumber', jiraNumber);
  if (easyvistaNumber) params.set('easyvistaNumber', easyvistaNumber);
  if (releaseNumber) params.set('releaseNumber', releaseNumber);
  if (sort) params.set('sort', sort);
  if (Array.isArray(fields) && fields.length > 0) {
    params.set('fields', fields.join(','));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

async function request(path, options = {}) {
  const { allowStatuses = [], ...fetchOptions } = options;
  const method = String(fetchOptions.method || 'GET').toUpperCase();
  const headers = { ...(fetchOptions.headers || {}) };
  if (!CSRF_SAFE_METHODS.has(method)) {
    const csrfToken = readCsrfToken();
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  }
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...fetchOptions,
    headers,
  });

  const isAllowedStatus = Array.isArray(allowStatuses) && allowStatuses.includes(response.status);

  if (!response.ok && !isAllowedStatus) {
    let message = `Request failed (${response.status})`;
    let errorBody = null;
    const text = await response.text();
    if (text) {
      try {
        const body = JSON.parse(text);
        errorBody = body;
        if (body?.error) {
          message = body.error;
        } else {
          message = text;
        }
      } catch {
        message = text;
      }
    }
    const error = new Error(message);
    error.status = response.status;
    error.body = errorBody;
    throw error;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  return null;
}

export const api = {
  // Who the server thinks the caller is, and what they may see. The single
  // source for identity on every surface — see hooks/useViewer.js. Always
  // returns 200: an anonymous caller gets the unauthenticated envelope rather
  // than an error, because the status board must work without a session.
  getViewer: () => request('/api/viewer'),
  getMetaOptions: () => request('/api/meta/options'),
  getAdminMetaOptions: () => request('/api/admin/meta/options'),
  createAdminMetaOption: (category, data) =>
    request(`/api/admin/meta/${encodeURIComponent(category)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {}),
    }),
  updateAdminMetaOption: (category, id, data) =>
    request(`/api/admin/meta/${encodeURIComponent(category)}/${encodeURIComponent(String(id))}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {}),
    }),
  reorderAdminMetaOptions: (category, orderedIds) =>
    request(`/api/admin/meta/${encodeURIComponent(category)}/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: Array.isArray(orderedIds) ? orderedIds : [] }),
    }),
  // ── Access (super users only) ──────────────────────────────────────────────
  // Every one of these 403s for a non-super-user; the page is only reachable for
  // someone the viewer envelope already reports as one.
  getAccess: () => request('/api/admin/access'),
  // The whole set for one person, replaced. `grants` is [{ applicationId, role }].
  setUserGrants: (userId, grants) =>
    request(`/api/admin/access/users/${encodeURIComponent(String(userId))}/grants`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grants: Array.isArray(grants) ? grants : [] }),
    }),
  setUserSuperUser: (userId, isSuperUser) =>
    request(`/api/admin/access/users/${encodeURIComponent(String(userId))}/super-user`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isSuperUser: Boolean(isSuperUser) }),
    }),
  // One change across many people and many applications. action: 'grant' | 'revoke'.
  // `requestType` narrows the grant to one submission type; '' is every type.
  bulkSetAccess: ({ userIds, applicationIds, role, action, requestType = '' }) =>
    request('/api/admin/access/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds, applicationIds, role, action, requestType }),
    }),
  // Which EasyVista catalog an application's tickets are raised in. Blank values
  // clear it, which refuses a real send for that application rather than letting
  // it post into another application's catalog.
  setApplicationEasyVista: (applicationId, { catalogGuid, catalogCode }) =>
    request(`/api/admin/access/applications/${encodeURIComponent(String(applicationId))}/easyvista`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogGuid, catalogCode }),
    }),
  addAdGroupMapping: ({ applicationId, groupName }) =>
    request('/api/admin/access/ad-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationId, groupName }),
    }),
  removeAdGroupMapping: (id) =>
    request(`/api/admin/access/ad-groups/${encodeURIComponent(String(id))}`, { method: 'DELETE' }),

  getAdminViewPreferences: () => request('/api/admin/view-preferences'),
  // `pinnedApplication` is the queue scope this admin lands on: an application
  // name, the '__all__' sentinel, or null to unpin. The endpoint replaces the
  // whole row, so every caller sends all three fields.
  saveAdminViewPreferences: ({ columns, filters, pinnedApplication = null }) =>
    request('/api/admin/view-preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns, filters, pinnedApplication }),
    }),
  resetAdminViewPreferences: () =>
    request('/api/admin/view-preferences', { method: 'DELETE' }),
  login: (username, password) =>
    request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me', { allowStatuses: [401] }),
  // Short-lived token for authenticating a direct Socket.IO connection. 401 for
  // non-admins (public watchers connect without a token).
  getRealtimeToken: () => request('/api/realtime/token', { allowStatuses: [401] }),
  submitRepSubmission: (formData) =>
    request('/api/submissions', {
      method: 'POST',
      body: formData,
    }),
  listPublicSubmissions: () => request('/api/public/submissions'),
  listAdminSubmissions: ({
    status = '',
    statuses = [],
    type = '',
    types = [],
    cleanupRequired = '',
    cleanupStatuses = [],
    search = '',
    requester = '',
    submittedBy = '',
    createdVia = '',
    // Which application's queue. Easy to miss when adding a filter: this
    // function destructures an explicit list and rebuilds the query object, so a
    // key absent HERE is dropped before buildAdminSubmissionsQuery ever sees it
    // — which is exactly how the scope switcher shipped filtering nothing.
    application = '',
    retiredFilter = 'non_retired',
    year = '',
    inJira = '',
    workaround = '',
    jiraNumber = '',
    easyvistaNumber = '',
    releaseNumber = '',
    sort = 'updated_desc',
  }) => {
    const query = buildAdminSubmissionsQuery({
      status,
      statuses,
      type,
      types,
      cleanupRequired,
      cleanupStatuses,
      search,
      requester,
      submittedBy,
      createdVia,
      application,
      retiredFilter,
      year,
      inJira,
      workaround,
      jiraNumber,
      easyvistaNumber,
      releaseNumber,
      sort,
    });
    return request(`/api/admin/submissions${query}`);
  },
  exportAdminSubmissionsXlsx: async ({ filters = {}, fields = [] } = {}) => {
    const query = buildAdminSubmissionsQuery({ ...(filters || {}), fields });
    const response = await fetch(`${API_BASE}/api/admin/submissions/export-xlsx${query}`, {
      method: 'GET',
      credentials: 'include',
    });

    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      const text = await response.text();
      if (text) {
        try {
          const body = JSON.parse(text);
          message = body?.error || text;
        } catch {
          message = text;
        }
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const contentDisposition = response.headers.get('content-disposition') || '';
    const match = contentDisposition.match(/filename="([^"]+)"/i);
    const fileName = match?.[1] || `admin-submissions-export-${new Date().toISOString().slice(0, 10)}.xlsx`;

    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
  getAdminSubmissionDetail: (id) => request(`/api/admin/submissions/${id}`),
  updateAdminSubmission: (id, data) =>
    request(`/api/admin/submissions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  // Hand a ticket to another application's queue. The ticket MOVES: it leaves
  // this queue as New for the receiving team, and the caller keeps read access
  // but loses write. `note` is optional and never reaches the reporter.
  redirectAdminSubmission: (id, { toApplicationId, note }) =>
    request(`/api/admin/submissions/${id}/redirect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toApplicationId, note }),
    }),
  // Bulk change of public visibility for many tickets in one request.
  // Returns { ok, is_public, requested, updated, failed } (failed = ids that errored).
  bulkUpdateVisibility: (ids, isPublic) =>
    request('/api/admin/submissions/bulk-visibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, is_public: isPublic }),
    }),
  // Bulk retire/unretire for many tickets in one request.
  // Returns { ok, is_retired, requested, updated, failed } (failed = ids that errored).
  bulkUpdateRetired: (ids, isRetired) =>
    request('/api/admin/submissions/bulk-retire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, is_retired: isRetired }),
    }),
  createAdminSubmission: (data) =>
    request('/api/admin/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  analyzeAdminSubmissionsXlsx: (formData) =>
    request('/api/admin/submissions/import-xlsx/analyze', {
      method: 'POST',
      body: formData,
    }),
  listAdminSubmissionsImportHistory: ({ limit = 10 } = {}) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return request(`/api/admin/submissions/import-xlsx/history${query}`);
  },
  getAdminExportFields: () => request('/api/admin/submissions/export-fields'),
  importAdminSubmissionsXlsx: (formData, {
    dryRun = false,
    sheet = '',
    importMode = '',
  } = {}) => {
    const params = new URLSearchParams();
    if (dryRun) params.set('dryRun', 'true');
    if (sheet) params.set('sheet', sheet);
    if (importMode) params.set('importMode', importMode);
    const query = params.toString() ? `?${params.toString()}` : '';
    return request(`/api/admin/submissions/import-xlsx${query}`, {
      method: 'POST',
      body: formData,
    });
  },
  uploadAdminAttachment: (id, formData) =>
    request(`/api/admin/submissions/${id}/attachments`, {
      method: 'POST',
      body: formData,
    }),
  deleteAdminAttachment: (id) =>
    request(`/api/admin/attachments/${id}`, {
      method: 'DELETE',
    }),
  // ── Report request delivery ───────────────────────────────────────────────
  // Hours are their own endpoints rather than part of the submission save: an
  // entry is its own row with its own author, and the save carries an
  // optimistic-concurrency token that logging time has no business bumping.
  logRequestHours: (id, entry) =>
    request(`/api/admin/submissions/${id}/time-entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }),
  deleteRequestHours: (id, entryId) =>
    request(`/api/admin/submissions/${id}/time-entries/${entryId}`, {
      method: 'DELETE',
    }),
  // Documents, not just images — and stored so they are readable only through
  // GET /api/admin/attachments/:id/file, never from the unauthenticated
  // /uploads path a screenshot uses.
  uploadApprovalFiles: (id, formData) =>
    request(`/api/admin/submissions/${id}/approval-files`, {
      method: 'POST',
      body: formData,
    }),
  getThroughput: ({ from, to, applicationId }) => {
    const params = new URLSearchParams({ from, to });
    if (applicationId) params.set('application_id', String(applicationId));
    return request(`/api/admin/throughput?${params.toString()}`);
  },
  previewEasyVista: (id, draft, sendAsType, attachmentIds) =>
    request(`/api/admin/submissions/${id}/easyvista-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft, sendAsType, attachmentIds }),
    }),
  submitToEasyVista: (id, data) =>
    request(`/api/admin/submissions/${id}/submit-easyvista`, {
      method: 'POST',
      ...(data
        ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
        : {}),
    }),
  // ── AI semantic search ──────────────────────────────────────────────────────
  // Both endpoints return { enabled, summary, matches, window, meta }. A 503
  // (enabled:false) means the feature isn't configured — callers hide the panel.
  getAiSearchStatus: () => request('/api/ai-search/status', { allowStatuses: [503] }),
  getAdminAiSearchStatus: () => request('/api/admin/ai-search/status', { allowStatuses: [401, 503] }),
  aiSearch: (params) =>
    request('/api/ai-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
      allowStatuses: [503],
    }),
  adminAiSearch: (params) =>
    request('/api/admin/submissions/ai-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
      allowStatuses: [503],
    }),
};
