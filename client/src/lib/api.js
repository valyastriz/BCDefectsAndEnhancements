const API_BASE = import.meta.env.VITE_API_BASE || '';

async function request(path, options = {}) {
  const { allowStatuses = [], ...fetchOptions } = options;
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...fetchOptions,
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
  login: (username, password) =>
    request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me', { allowStatuses: [401] }),
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
    search = '',
    requester = '',
    submittedBy = '',
    createdVia = '',
    retiredFilter = 'non_retired',
    year = '',
    inJira = '',
    jiraNumber = '',
    releaseNumber = '',
    sort = 'updated_desc',
  }) => {
    const params = new URLSearchParams();
    if (Array.isArray(statuses) && statuses.length > 0) {
      params.set('statuses', statuses.join(','));
    } else if (status) {
      params.set('status', status);
    }
    if (type) params.set('type', type);
    if (search) params.set('search', search);
    if (requester) params.set('requester', requester);
    if (submittedBy) params.set('submittedBy', submittedBy);
    if (createdVia) params.set('createdVia', createdVia);
    if (retiredFilter) params.set('retiredFilter', retiredFilter);
    if (year) params.set('year', year);
    if (inJira) params.set('inJira', inJira);
    if (jiraNumber) params.set('jiraNumber', jiraNumber);
    if (releaseNumber) params.set('releaseNumber', releaseNumber);
    if (sort) params.set('sort', sort);
    const query = params.toString() ? `?${params.toString()}` : '';
    return request(`/api/admin/submissions${query}`);
  },
  getAdminSubmissionDetail: (id) => request(`/api/admin/submissions/${id}`),
  updateAdminSubmission: (id, data) =>
    request(`/api/admin/submissions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
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
};
