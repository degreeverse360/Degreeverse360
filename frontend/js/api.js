/**
 * Degreeverse360 — API client
 * All backend communication goes through this module.
 */
const Api = (() => {
  const DEFAULT_BASE = localStorage.getItem('dgv_api_base') || '';

  function getBase() {
    return localStorage.getItem('dgv_api_base') || DEFAULT_BASE;
  }
  function setBase(url) {
    localStorage.setItem('dgv_api_base', url.replace(/\/$/, ''));
  }
  function getToken() {
    return localStorage.getItem('dgv_token');
  }
  function setToken(token) {
    if (token) localStorage.setItem('dgv_token', token);
    else localStorage.removeItem('dgv_token');
  }
  function setUser(user) {
    if (user) localStorage.setItem('dgv_user', JSON.stringify(user));
    else localStorage.removeItem('dgv_user');
  }
  function getUser() {
    try { return JSON.parse(localStorage.getItem('dgv_user')); } catch { return null; }
  }

  async function request(path, { method = 'GET', body, isForm = false, raw = false } = {}) {
    const base = getBase();
    if (!base) throw new Error('API server URL is not set. Add it on the login screen.');

    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: isForm ? body : (body !== undefined ? JSON.stringify(body) : undefined),
      });
    } catch (networkErr) {
      throw new Error('Could not reach the API server. Check the server URL and your connection.');
    }

    if (response.status === 401) {
      setToken(null);
      setUser(null);
      window.location.hash = '#/login';
      window.dispatchEvent(new Event('dgv:unauthorized'));
      throw new Error('Your session expired. Please log in again.');
    }

    if (raw) return response; // caller handles (e.g. CSV blob download)

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : await response.text();

    if (!response.ok) {
      const message = (data && data.error) || data.message || 'Something went wrong. Please try again.';
      const err = new Error(message);
      err.payload = data;
      err.status = response.status;
      throw err;
    }
    return data;
  }

  return {
    getBase, setBase, getToken, setToken, getUser, setUser,
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body }),
    patch: (path, body) => request(path, { method: 'PATCH', body }),
    del: (path) => request(path, { method: 'DELETE' }),
    postForm: (path, formData) => request(path, { method: 'POST', body: formData, isForm: true }),
    raw: (path) => request(path, { raw: true }),
  };
})();
