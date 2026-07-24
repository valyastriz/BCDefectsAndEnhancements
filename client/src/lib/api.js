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
  retiredFilter = 'non_retired',
  year = '',
  inJira = '',
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
  if (retiredFilter) params.set('retiredFilter', retiredFilter);
  if (year) params.set('year', year);
  if (inJira) params.set('inJira', inJira);
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
  getAdminViewPreferences: () => request('/api/admin/view-preferences'),
  saveAdminViewPreferences: ({ columns, filters }) =>
    request('/api/admin/view-preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns, filters }),
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
    retiredFilter = 'non_retired',
    year = '',
    inJira = '',
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
      retiredFilter,
      year,
      inJira,
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
