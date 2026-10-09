// Every call to the server goes through here. See API.md at the project root.

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', field = '' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

async function request(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError("Can't reach the server. Check that it is still running, then try again.", { code: 'network' });
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const err = (data && data.error) || {};
    throw new ApiError(err.message || `Something went wrong (${response.status}).`, {
      status: response.status,
      code: err.code || '',
      field: err.field || '',
    });
  }
  return data || {};
}

export const api = {
  availability: () => request('GET', '/api/availability'),
  book: (payload) => request('POST', '/api/bookings', payload),
  icsUrl: (id) => `/api/bookings/${encodeURIComponent(id)}/ics`,

  session: () => request('GET', '/api/admin/session'),
  login: (passcode) => request('POST', '/api/admin/login', { passcode }),
  logout: () => request('POST', '/api/admin/logout'),
  bookings: () => request('GET', '/api/admin/bookings'),
  cancel: (id) => request('DELETE', `/api/admin/bookings/${encodeURIComponent(id)}`),
  clearSamples: () => request('POST', '/api/admin/clear-samples'),
  seedSamples: () => request('POST', '/api/admin/seed-samples'),
  config: () => request('GET', '/api/admin/config'),
  saveConfig: (patch) => request('PUT', '/api/admin/config', patch),
};
