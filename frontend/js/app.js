/**
 * Degreeverse360 CRM — Frontend application
 * Vanilla JS single-page app. No build step required.
 */

// ---------------------------------------------------------
// ICONS (tiny inline SVGs, avoids an icon-font dependency)
// ---------------------------------------------------------
const ICONS = {
  grid: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="3" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="13" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="13" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.8"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.8"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="8" r="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M15.5 14.2c2.7.4 4.7 2.7 4.7 5.8" stroke="currentColor" stroke-width="1.8"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 20V10M12 20V4M20 20v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  team: '<svg viewBox="0 0 24 24" fill="none"><circle cx="8" cy="9" r="3" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="9" r="2.4" stroke="currentColor" stroke-width="1.8"/><path d="M2.5 20c0-3 2.5-5.4 5.5-5.4s5.5 2.4 5.5 5.4M14.5 15c2.6.3 4.5 2.4 4.5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  cog: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7.3 7.3 0 0 0-2-1.2L14.2 3H9.8l-.4 2.6a7.3 7.3 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9c.6.5 1.3.9 2 1.2l.4 2.6h4.4l.4-2.6c.7-.3 1.4-.7 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
};
function renderIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const name = el.getAttribute('data-icon');
    if (ICONS[name]) el.innerHTML = ICONS[name];
  });
}

// ---------------------------------------------------------
// STATE
// ---------------------------------------------------------
const State = {
  user: null,
  leadsCache: { data: [], pagination: {} },
  refData: { statuses: [], sources: [], campaigns: [], courses: [], universities: [], tags: [], counselors: [] },
  leadFilters: {},
};

// ---------------------------------------------------------
// TOAST + CONFIRM
// ---------------------------------------------------------
function toast(message, type = 'success') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.style.cssText = `
    background:${type === 'error' ? '#E14B4B' : type === 'info' ? '#2A3EB1' : '#1FAE6B'};
    color:#fff;padding:12px 18px;border-radius:10px;font-size:13.5px;font-weight:600;
    box-shadow:0 8px 24px rgba(0,0,0,0.18);margin-top:8px;max-width:340px;`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3500);
}
if (!document.getElementById('toast-style')) {
  const s = document.createElement('style');
  s.id = 'toast-style';
  s.textContent = '.toast-root{position:fixed;top:18px;right:18px;z-index:9999;display:flex;flex-direction:column;align-items:flex-end;}';
  document.head.appendChild(s);
}

function confirmDialog(message, { danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-panel" style="max-width:380px;margin-top:14vh;">
        <div class="modal-body" style="padding-top:24px;">
          <p style="font-size:14.5px;line-height:1.5;margin:0 0 20px;">${message}</p>
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button class="btn btn-ghost" id="confirm-no">Cancel</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-yes">${danger ? 'Delete' : 'Confirm'}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#confirm-no').onclick = () => { overlay.remove(); resolve(false); };
    overlay.querySelector('#confirm-yes').onclick = () => { overlay.remove(); resolve(true); };
    overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
  });
}

function openModal(html, { wide = false } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-panel ${wide ? 'wide' : ''}">${html}</div>`;
  document.getElementById('modal-root').appendChild(overlay);

  let dirty = false;
  overlay.addEventListener('input', () => { dirty = true; });
  function tryClose() {
    if (dirty) {
      confirmDialog('Discard your unsaved changes?', { danger: true }).then((yes) => { if (yes) overlay.remove(); });
    } else {
      overlay.remove();
    }
  }
  overlay.querySelectorAll('.modal-close').forEach((b) => b.onclick = tryClose);
  overlay.onclick = (e) => { if (e.target === overlay) tryClose(); };

  // Keyboard-friendly: auto-focus the first field, and Enter submits (except inside a textarea).
  setTimeout(() => {
    const firstField = overlay.querySelector('.modal-body input, .modal-body select, .modal-body textarea');
    if (firstField) firstField.focus();
  }, 30);
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      overlay.querySelector('.modal-footer .btn-primary')?.click();
    }
    if (e.key === 'Escape') tryClose();
  });
  return overlay;
}

// ---------------------------------------------------------
// FORMAT HELPERS
// ---------------------------------------------------------
const fmt = {
  date: (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
  dateTime: (d) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—',
  time: (t) => t ? t.slice(0, 5) : '',
  money: (n) => n ? `₹${Number(n).toLocaleString('en-IN')}` : '—',
  initials: (name) => (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase(),
  timeAgo: (d) => {
    if (!d) return '';
    const diff = (Date.now() - new Date(d).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  },
};

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function skeletonRows(count = 5) {
  return `<div class="table-card">${Array.from({ length: count }).map(() => `
    <div class="skeleton-row" style="border-bottom:1px solid var(--line);">
      <div class="skeleton-block"></div>
      <div class="skeleton-line skeleton-block"></div>
      <div class="skeleton-line skeleton-block" style="max-width:80px;"></div>
      <div class="skeleton-line skeleton-block" style="max-width:60px;"></div>
    </div>
  `).join('')}</div>`;
}

// ---------------------------------------------------------
// AUTH
// ---------------------------------------------------------
function showLogin() {
  const loginEl = document.getElementById('login-screen');
  const appEl = document.getElementById('app-shell');
  loginEl.hidden = false;
  loginEl.style.display = 'flex';
  appEl.hidden = true;
  appEl.style.display = 'none';
  document.getElementById('api-base-input').value = Api.getBase() || '';
}

function showApp() {
  const loginEl = document.getElementById('login-screen');
  const appEl = document.getElementById('app-shell');
  loginEl.hidden = true;
  loginEl.style.display = 'none';
  appEl.hidden = false;
  appEl.style.display = 'flex';
  renderSidebarForRole();
  renderUserChip();
  renderIcons();
  loadNotifications();
  setInterval(loadNotifications, 45000);
  if (!location.hash || location.hash === '#/login') location.hash = '#/dashboard';
  router();
}

document.getElementById('save-api-url').onclick = () => {
  const val = document.getElementById('api-base-input').value.trim();
  if (val) { Api.setBase(val); toast('API server URL saved.', 'info'); }
};

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  errEl.hidden = true;
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const apiUrl = document.getElementById('api-base-input').value.trim();
  if (apiUrl) Api.setBase(apiUrl);

  const btn = document.getElementById('login-submit');
  btn.disabled = true; btn.textContent = 'Logging in…';
  try {
    const res = await Api.post('/auth/login', { email, password });
    Api.setToken(res.token);
    Api.setUser(res.user);
    State.user = res.user;
    await preloadRefData();
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Log in';
  }
});

document.getElementById('logout-btn').onclick = () => {
  Api.setToken(null); Api.setUser(null); State.user = null;
  location.hash = '#/login';
  showLogin();
};

document.getElementById('change-password-btn').onclick = () => {
  const overlay = openModal(`
    <div class="modal-header"><h3>Change your password</h3><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-field" style="margin-bottom:14px;"><label>Current password</label><input type="password" id="cp-current" /></div>
      <div class="form-field" style="margin-bottom:6px;"><label>New password (min. 8 characters)</label><input type="password" id="cp-new" /></div>
      <p id="cp-error" class="form-error" hidden></p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost modal-close">Cancel</button>
      <button class="btn btn-primary" id="cp-save">Update password</button>
    </div>
  `);
  overlay.querySelector('#cp-save').onclick = async () => {
    const currentPassword = document.getElementById('cp-current').value;
    const newPassword = document.getElementById('cp-new').value;
    const errEl = document.getElementById('cp-error');
    errEl.hidden = true;
    if (!currentPassword || !newPassword) { errEl.textContent = 'Both fields are required.'; errEl.hidden = false; return; }
    if (newPassword.length < 8) { errEl.textContent = 'New password must be at least 8 characters.'; errEl.hidden = false; return; }
    try {
      await Api.post('/auth/change-password', { currentPassword, newPassword });
      toast('Password updated.');
      overlay.remove();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  };
};

function renderSidebarForRole() {
  const role = State.user?.role;
  document.querySelectorAll('#sidebar-nav a, #bottom-tabs a').forEach((a) => {
    const allowed = a.getAttribute('data-role');
    a.style.display = (!allowed || allowed.split(',').includes(role)) ? '' : 'none';
  });
}

function renderUserChip() {
  const u = State.user;
  if (!u) return;
  document.getElementById('user-chip').innerHTML = `
    <div class="user-avatar" style="background:${u.avatar_color || '#2A3EB1'}">${fmt.initials(u.name)}</div>
    <div class="user-chip-info">
      <div class="user-chip-name">${esc(u.name)}</div>
      <div class="user-chip-role">${esc((u.role || '').replace('_', ' '))}</div>
    </div>`;
}

// ---------------------------------------------------------
// NOTIFICATIONS
// ---------------------------------------------------------
async function loadNotifications() {
  try {
    const res = await Api.get('/notifications');
    const badge = document.getElementById('notif-badge');
    if (res.unreadCount > 0) { badge.hidden = false; badge.textContent = res.unreadCount; } else { badge.hidden = true; }
    const dd = document.getElementById('notif-dropdown');
    dd.innerHTML = res.notifications.length
      ? res.notifications.map((n) => `
        <div class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}">
          <div>${esc(n.message)}</div>
          <div class="notif-time">${fmt.timeAgo(n.created_at)}</div>
        </div>`).join('')
      : `<div class="notif-empty">No notifications yet.</div>`;
  } catch (e) { /* silent */ }
}
document.getElementById('notif-btn').onclick = async (e) => {
  e.stopPropagation();
  const dd = document.getElementById('notif-dropdown');
  dd.hidden = !dd.hidden;
  if (!dd.hidden) { await Api.patch('/notifications/read-all', {}); loadNotifications(); }
};
document.addEventListener('click', () => { document.getElementById('notif-dropdown').hidden = true; });

// ---------------------------------------------------------
// SIDEBAR MOBILE TOGGLE
// ---------------------------------------------------------
document.getElementById('hamburger-btn').onclick = () => document.getElementById('sidebar').classList.toggle('open');
document.getElementById('page-content').addEventListener('click', () => document.getElementById('sidebar').classList.remove('open'));

// ---------------------------------------------------------
// GLOBAL SEARCH
// ---------------------------------------------------------
let searchDebounce;
document.getElementById('global-search').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  const val = e.target.value.trim();
  searchDebounce = setTimeout(() => {
    if (val.length >= 2) { location.hash = `#/leads?search=${encodeURIComponent(val)}`; }
  }, 400);
});

// ---------------------------------------------------------
// REFERENCE DATA (statuses, sources, courses, etc.)
// ---------------------------------------------------------
async function preloadRefData() {
  try {
    const [statuses, sources, campaigns, courses, universities, tags, counselors] = await Promise.all([
      Api.get('/settings/statuses'), Api.get('/settings/sources'), Api.get('/settings/campaigns'),
      Api.get('/settings/courses-detailed'), Api.get('/settings/universities'), Api.get('/settings/tags'),
      Api.get('/users/counselors'),
    ]);
    State.refData = { statuses, sources, campaigns, courses, universities, tags, counselors };
  } catch (e) { console.warn('Ref data load failed', e); }
}

// ---------------------------------------------------------
// ROUTER
// ---------------------------------------------------------
const routes = {
  dashboard: renderDashboard,
  leads: renderLeadsList,
  lead: renderLeadProfile,
  followups: renderFollowupsPage,
  counselors: renderCounselorsPage,
  settings: renderSettingsPage,
  reports: renderReportsPage,
  commissions: renderCommissionsPage,
  'assignment-leads': renderAssignmentLeadsList,
  'assignment-lead': renderAssignmentLeadProfile,
};

function parseHash() {
  const hash = location.hash.replace(/^#\//, '');
  const [pathPart, queryPart] = hash.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { page: segments[0] || 'dashboard', param: segments[1], query };
}

async function router() {
  if (!Api.getToken()) { showLogin(); return; }
  const { page, param, query } = parseHash();
  document.querySelectorAll('#sidebar-nav a, #bottom-tabs a').forEach((a) => a.classList.toggle('active', a.dataset.route === page));
  const content = document.getElementById('page-content');
  content.innerHTML = skeletonRows(4);
  const handler = routes[page] || renderDashboard;
  try {
    await handler(content, param, query);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Something went wrong</h3><p>${esc(err.message)}</p></div>`;
  }
  renderIcons();
}
window.addEventListener('hashchange', router);

// ---------------------------------------------------------
// BOOTSTRAP
// ---------------------------------------------------------
(async function init() {
  const token = Api.getToken();
  const user = Api.getUser();
  if (token && user) {
    State.user = user;
    showLogin(); // show shell only after ref data loads, to avoid flash of empty nav
    try {
      await preloadRefData();
      showApp();
    } catch (e) {
      showLogin();
    }
  } else {
    showLogin();
  }
})();
