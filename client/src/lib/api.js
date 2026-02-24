const API_BASE = import.meta.env.VITE_API_BASE || '';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body.error) message = body.error;
    } catch {
      const text = await response.text();
      if (text) message = text;
    }
    throw new Error(message);
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
  me: () => request('/api/auth/me'),
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
  uploadAdminAttachment: (id, formData) =>
    request(`/api/admin/submissions/${id}/attachments`, {
      method: 'POST',
      body: formData,
    }),
  deleteAdminAttachment: (id) =>
    request(`/api/admin/attachments/${id}`, {
      method: 'DELETE',
    }),
  submitToEasyVista: (id) =>
    request(`/api/admin/submissions/${id}/submit-easyvista`, {
      method: 'POST',
    }),
};
