const DISPLAY_TOKEN_KEY = 'frame.displayToken';

export function getDisplayToken() {
  try {
    return localStorage.getItem(DISPLAY_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setDisplayToken(token) {
  try {
    if (token) localStorage.setItem(DISPLAY_TOKEN_KEY, token);
    else localStorage.removeItem(DISPLAY_TOKEN_KEY);
  } catch {
    /* private browsing — the token just won't persist across reloads */
  }
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = {};
  const token = getDisplayToken();
  if (token) headers['X-Display-Token'] = token;
  if (body && !isForm) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* empty or non-JSON response */
  }

  if (!res.ok) {
    throw new ApiError(payload?.error || `Request failed (${res.status})`, res.status);
  }
  return payload;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  del: (path) => request(path, { method: 'DELETE' }),
  upload: (path, formData) => request(path, { method: 'POST', body: formData, isForm: true }),
};

/** Image URL for a photo. The display token rides along for the kiosk. */
export function photoUrl(id, size = 'display') {
  const token = getDisplayToken();
  const query = new URLSearchParams({ size });
  if (token) query.set('display_token', token);
  return `/api/photos/${id}/file?${query}`;
}
