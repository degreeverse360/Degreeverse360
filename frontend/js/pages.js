/**
 * Degreeverse360 — Page renderers: Dashboard, Followups, Counselors, Settings, Reports
 * (Leads list/profile/CSV import live in leadform.js)
 */

let dashboardCharts = [];

// =========================================================
// COUNSELOR HOME — a simpler "what's due today" view
// =========================================================
async function renderCounselorHome(content) {
  const [d, today, overdue] = await Promise.all([
    Api.get('/dashboard'),
    Api.get('/followups?range=today'),
    Api.get('/followups?range=overdue'),
  ]);

  content.innerHTML = `
    <div class="page-header">
      <div><h2>Good day, ${esc((State.user.name || '').split(' ')[0])}</h2><div class="subtitle">Here's what needs your attention today.</div></div>
      <div class="page-actions"><button class="btn btn-primary" id="dash-add-lead">+ Add lead</button></div>
    </div>

    <div class="stats-grid">
      <div class="mini-stat"><div class="mini-number">${d.totalLeads}</div><div class="mini-label">My leads</div></div>
      <div class="mini-stat"><div class="mini-number" style="color:var(--coral-500)">${overdue.length}</div><div class="mini-label">Overdue follow-ups</div></div>
      <div class="mini-stat"><div class="mini-number">${today.length}</div><div class="mini-label">Due today</div></div>
      <div class="mini-stat"><div class="mini-number" style="color:var(--green-500)">${d.conversionRate}%</div><div class="mini-label">My conversion rate</div></div>
    </div>

    ${overdue.length ? `
      <div class="pipeline-card" style="border:1.5px solid var(--coral-500);">
        <div class="pipeline-title" style="color:var(--coral-500);">⚠ Overdue — handle these first</div>
        ${overdue.map((f) => followupRow(f, true)).join('')}
      </div>
    ` : ''}

    <div class="pipeline-card">
      <div class="pipeline-title">Today's follow-ups</div>
      ${today.length ? today.map((f) => followupRow(f, false)).join('') : '<p style="color:var(--ink-500);font-size:13px;">Nothing scheduled for today. 🎉</p>'}
    </div>

    <div style="margin-top:18px;">
      <a href="#/leads" class="btn btn-secondary">View all my leads →</a>
    </div>
  `;
  document.getElementById('dash-add-lead').onclick = () => openLeadFormModal();
  content.querySelectorAll('[data-complete-fu]').forEach((btn) => btn.onclick = async () => {
    await Api.patch(`/followups/${btn.dataset.completeFu}`, { status: 'Completed' });
    toast('Follow-up completed.');
    renderCounselorHome(content);
  });
}

function followupRow(f, overdue) {
  return `
    <div class="followup-item ${overdue ? 'overdue' : ''}" style="margin-bottom:8px;">
      <div>
        <div class="fu-main">${esc(f.full_name)} · ${esc(f.followup_type)}</div>
        <div class="fu-sub">${esc(f.lead_code)} · ${esc(f.mobile)} · ${fmt.date(f.scheduled_date)} ${fmt.time(f.scheduled_time)}</div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-success btn-small" data-complete-fu="${f.id}">Done</button>
        <a class="btn btn-ghost btn-small" href="#/lead/${f.lead_id}">Open</a>
      </div>
    </div>`;
}

async function renderDashboard(content) {
  if (State.user.role === 'counselor') return renderCounselorHome(content);
  const d = await Api.get('/dashboard');
  dashboardCharts.forEach((c) => c.destroy());
  dashboardCharts = [];

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2>Welcome back, ${esc((State.user.name || '').split(' ')[0])}</h2>
        <div class="subtitle">Here's how Degreeverse360 is performing today.</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="dash-add-lead">+ Add lead</button>
      </div>
    </div>

    <div class="hero-stats">
      <div class="hero-card">
        <div class="hero-label">Total leads</div>
        <div class="hero-number">${d.totalLeads}</div>
        <div class="hero-sub">
          <span>${d.todaysLeads} added today</span>
          <span>${d.conversionRate}% conversion rate</span>
        </div>
      </div>
      <div class="stat-tile">
        <div class="stat-number">${d.newLeads}</div>
        <div class="stat-label">New leads</div>
      </div>
      <div class="stat-tile">
        <div class="stat-number">${d.interestedLeads}</div>
        <div class="stat-label">Interested leads</div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="mini-stat"><div class="mini-number">${d.followupsToday}</div><div class="mini-label">Follow-ups today</div></div>
      <div class="mini-stat"><div class="mini-number" style="color:var(--coral-500)">${d.overdueFollowups}</div><div class="mini-label">Overdue follow-ups</div></div>
      <div class="mini-stat"><div class="mini-number">${d.applications}</div><div class="mini-label">Applications</div></div>
      <div class="mini-stat"><div class="mini-number" style="color:var(--green-500)">${d.enrollments}</div><div class="mini-label">Enrollments</div></div>
    </div>

    <div class="pipeline-card">
      <div class="pipeline-title">Lead pipeline — where every lead stands right now</div>
      <div class="pipeline-track" id="pipeline-track"></div>
      <div class="pipeline-legend" id="pipeline-legend"></div>
    </div>

    <div class="charts-row">
      <div class="chart-card"><h3>Source-wise leads</h3><canvas id="chart-source"></canvas></div>
      <div class="chart-card"><h3>Counselor performance</h3><canvas id="chart-counselor"></canvas></div>
    </div>

    <div class="charts-row">
      <div class="chart-card"><h3>Course-wise interest (top 10)</h3><canvas id="chart-course"></canvas></div>
      <div class="chart-card"><h3>University-wise interest (top 10)</h3><canvas id="chart-university"></canvas></div>
    </div>
  `;

  document.getElementById('dash-add-lead').onclick = () => openLeadFormModal();

  // Pipeline bar
  const total = d.statusBreakdown.reduce((s, r) => s + Number(r.count), 0) || 1;
  document.getElementById('pipeline-track').innerHTML = d.statusBreakdown.map((s) => `
    <div class="pipeline-seg" style="background:${s.color};flex-grow:${Math.max(Number(s.count), 0.2)}"
         title="${esc(s.status)}: ${s.count}">${Number(s.count) / total > 0.06 ? s.count : ''}</div>
  `).join('');
  document.getElementById('pipeline-legend').innerHTML = d.statusBreakdown.map((s) => `
    <div class="pipeline-legend-item"><span class="pipeline-dot" style="background:${s.color}"></span>${esc(s.status)} (${s.count})</div>
  `).join('');

  const palette = ['#2A3EB1', '#00B8A9', '#F5A623', '#7C5CFC', '#E14B4B', '#1FAE6B', '#3B4FD1', '#A6AAC6'];

  if (typeof Chart === 'undefined') {
    // Chart library hasn't loaded yet (slow network) — retry briefly, then fall back gracefully.
    let attempts = 0;
    const retry = setInterval(() => {
      attempts++;
      if (typeof Chart !== 'undefined') {
        clearInterval(retry);
        renderDashboard(content);
      } else if (attempts >= 6) {
        clearInterval(retry);
        document.querySelectorAll('.chart-card canvas').forEach((c) => {
          c.parentElement.innerHTML += '<p style="color:var(--ink-500);font-size:12.5px;">Charts couldn\'t load — check your connection and reopen this page.</p>';
        });
      }
    }, 500);
    return;
  }

  dashboardCharts.push(new Chart(document.getElementById('chart-source'), {
    type: 'doughnut',
    data: {
      labels: d.sourceBreakdown.map((r) => r.source || 'Unknown'),
      datasets: [{ data: d.sourceBreakdown.map((r) => r.count), backgroundColor: palette }],
    },
    options: { plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 } } } } },
  }));

  dashboardCharts.push(new Chart(document.getElementById('chart-counselor'), {
    type: 'bar',
    data: {
      labels: d.counselorPerformance.map((r) => r.name),
      datasets: [
        { label: 'Assigned', data: d.counselorPerformance.map((r) => r.assigned_leads), backgroundColor: '#E7E9FA' },
        { label: 'Converted', data: d.counselorPerformance.map((r) => r.converted), backgroundColor: '#00B8A9' },
      ],
    },
    options: { plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } } }, scales: { x: { stacked: false } } },
  }));

  dashboardCharts.push(new Chart(document.getElementById('chart-course'), {
    type: 'bar',
    data: { labels: d.courseBreakdown.map((r) => r.course), datasets: [{ data: d.courseBreakdown.map((r) => r.count), backgroundColor: '#7C5CFC' }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } } },
  }));

  dashboardCharts.push(new Chart(document.getElementById('chart-university'), {
    type: 'bar',
    data: { labels: d.universityBreakdown.map((r) => r.university), datasets: [{ data: d.universityBreakdown.map((r) => r.count), backgroundColor: '#F5A623' }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } } },
  }));
}

// =========================================================
// FOLLOW-UPS PAGE
// =========================================================
async function renderFollowupsPage(content) {
  content.innerHTML = `
    <div class="page-header">
      <div><h2>Follow-ups</h2><div class="subtitle">Stay on top of every commitment to a lead.</div></div>
    </div>
    <div class="settings-tabs" id="fu-tabs">
      <button class="settings-tab active" data-range="today">Today</button>
      <button class="settings-tab" data-range="upcoming">Upcoming</button>
      <button class="settings-tab" data-range="overdue">Overdue</button>
    </div>
    <div id="fu-list"></div>
  `;
  async function load(range) {
    document.querySelectorAll('#fu-tabs .settings-tab').forEach((b) => b.classList.toggle('active', b.dataset.range === range));
    const list = document.getElementById('fu-list');
    list.innerHTML = `<div class="empty-state">Loading…</div>`;
    const rows = await Api.get(`/followups?range=${range}`);
    if (!rows.length) { list.innerHTML = `<div class="empty-state"><h3>Nothing here</h3><p>No ${range} follow-ups.</p></div>`; return; }
    const isOverdue = range === 'overdue';
    list.innerHTML = rows.map((f) => `
      <div class="followup-item ${isOverdue ? 'overdue' : ''}">
        <div>
          <div class="fu-main">${esc(f.full_name)} · ${esc(f.followup_type)}</div>
          <div class="fu-sub">${esc(f.lead_code)} · ${esc(f.mobile)} · ${fmt.date(f.scheduled_date)} ${fmt.time(f.scheduled_time)} · ${esc(f.counselor_name || 'Unassigned')}</div>
          ${f.notes ? `<div class="fu-sub">${esc(f.notes)}</div>` : ''}
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-success btn-small" data-complete="${f.id}">Mark done</button>
          <a class="btn btn-ghost btn-small" href="#/lead/${f.lead_id}">Open lead</a>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('[data-complete]').forEach((btn) => btn.onclick = async () => {
      await Api.patch(`/followups/${btn.dataset.complete}`, { status: 'Completed' });
      toast('Follow-up marked complete.');
      load(range);
    });
  }
  document.querySelectorAll('#fu-tabs .settings-tab').forEach((b) => b.onclick = () => load(b.dataset.range));
  load('today');
}

// =========================================================
// COUNSELORS PAGE
// =========================================================
async function renderCounselorsPage(content) {
  const users = await Api.get('/users');
  const isSuperAdmin = State.user.role === 'super_admin';

  content.innerHTML = `
    <div class="page-header">
      <div><h2>Team</h2><div class="subtitle">Counselors and admins, with live performance.</div></div>
      ${isSuperAdmin ? `<div class="page-actions"><button class="btn btn-primary" id="add-user-btn">+ Add team member</button></div>` : ''}
    </div>
    <div class="table-card">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Name</th><th>Role</th><th>Mobile</th><th>Assigned</th><th>Converted</th><th>Lost</th><th>Follow-ups done</th><th>Status</th>${isSuperAdmin ? '<th>Actions</th>' : ''}
          </tr></thead>
          <tbody>
            ${users.map((u) => `
              <tr>
                <td><div class="lead-name-cell"><strong>${esc(u.name)}</strong><small>${esc(u.email)}</small></div></td>
                <td><span class="badge priority-Low">${esc(u.role.replace('_', ' '))}</span></td>
                <td>${esc(u.mobile || '—')}</td>
                <td>${u.assigned_leads}</td>
                <td style="color:var(--green-500);font-weight:700;">${u.converted_leads}</td>
                <td style="color:var(--coral-500);font-weight:700;">${u.lost_leads}</td>
                <td>${u.followups_completed}</td>
                <td>${u.is_active ? '<span class="badge priority-Low" style="background:var(--green-100);color:var(--green-500);">Active</span>' : '<span class="badge priority-High">Inactive</span>'}</td>
                ${isSuperAdmin ? `<td><button class="btn btn-ghost btn-small" data-edit-user="${u.id}">Edit</button></td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (isSuperAdmin) {
    document.getElementById('add-user-btn').onclick = () => openUserFormModal();
    content.querySelectorAll('[data-edit-user]').forEach((btn) => {
      const user = users.find((u) => u.id == btn.dataset.editUser);
      btn.onclick = () => openUserFormModal(user);
    });
  }
}

function openUserFormModal(user = null) {
  const overlay = openModal(`
    <div class="modal-header"><h3>${user ? 'Edit team member' : 'Add team member'}</h3><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="form-field"><label>Full name</label><input id="uf-name" value="${esc(user?.name || '')}" /></div>
        <div class="form-field"><label>Email</label><input id="uf-email" type="email" value="${esc(user?.email || '')}" ${user ? 'disabled' : ''} /></div>
        <div class="form-field"><label>Mobile</label><input id="uf-mobile" value="${esc(user?.mobile || '')}" /></div>
        <div class="form-field"><label>Role</label>
          <select id="uf-role">
            <option value="counselor" ${user?.role === 'counselor' ? 'selected' : ''}>Counselor</option>
            <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>Admin</option>
            <option value="super_admin" ${user?.role === 'super_admin' ? 'selected' : ''}>Super Admin</option>
          </select>
        </div>
        <div class="form-field"><label>${user ? 'New password (optional)' : 'Password'}</label><input id="uf-password" type="password" placeholder="Min. 8 characters" /></div>
        ${user ? `<div class="form-field"><label>Status</label><select id="uf-active"><option value="true" ${user.is_active ? 'selected' : ''}>Active</option><option value="false" ${!user.is_active ? 'selected' : ''}>Inactive</option></select></div>` : ''}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost modal-close">Cancel</button>
      <button class="btn btn-primary" id="uf-save">${user ? 'Save changes' : 'Create account'}</button>
    </div>
  `);
  overlay.querySelector('#uf-save').onclick = async () => {
    try {
      const payload = {
        name: document.getElementById('uf-name').value.trim(),
        mobile: document.getElementById('uf-mobile').value.trim(),
        role: document.getElementById('uf-role').value,
      };
      const pw = document.getElementById('uf-password').value;
      if (pw) payload.password = pw;
      if (user) {
        payload.is_active = document.getElementById('uf-active').value === 'true';
        await Api.patch(`/users/${user.id}`, payload);
        toast('Team member updated.');
      } else {
        payload.email = document.getElementById('uf-email').value.trim();
        if (!payload.password) { toast('Password is required.', 'error'); return; }
        await Api.post('/users', payload);
        toast('Team member created.');
      }
      overlay.remove();
      router();
    } catch (err) { toast(err.message, 'error'); }
  };
}

// =========================================================
// SETTINGS PAGE
// =========================================================
const SETTINGS_TABS = [
  { key: 'statuses', label: 'Lead Statuses', endpoint: '/settings/statuses' },
  { key: 'sources', label: 'Sources', endpoint: '/settings/sources' },
  { key: 'campaigns', label: 'Campaigns', endpoint: '/settings/campaigns' },
  { key: 'universities', label: 'Universities', endpoint: '/settings/universities' },
  { key: 'courses', label: 'Courses', endpoint: '/settings/courses-detailed' },
  { key: 'tags', label: 'Tags', endpoint: '/settings/tags' },
];

async function renderSettingsPage(content, param, query) {
  const active = query.tab || 'statuses';
  content.innerHTML = `
    <div class="page-header">
      <div><h2>Admin Settings</h2><div class="subtitle">Customize the fields your team works with every day.</div></div>
      <div class="page-actions"><button class="btn btn-primary" id="settings-add-btn">+ Add new</button></div>
    </div>
    <div class="settings-tabs">
      ${SETTINGS_TABS.map((t) => `<a class="settings-tab ${t.key === active ? 'active' : ''}" href="#/settings?tab=${t.key}">${t.label}</a>`).join('')}
    </div>
    <div class="table-card" id="settings-list"><div class="empty-state">Loading…</div></div>
  `;
  const tab = SETTINGS_TABS.find((t) => t.key === active) || SETTINGS_TABS[0];
  const rows = await Api.get(tab.endpoint);
  const listEl = document.getElementById('settings-list');

  if (tab.key === 'statuses') {
    listEl.innerHTML = rows.map((s) => `
      <div class="simple-list-row">
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="pipeline-dot" style="background:${s.color}"></span>
          <strong>${esc(s.name)}</strong>
          ${s.is_won ? '<span class="badge" style="background:var(--green-100);color:var(--green-500)">Won</span>' : ''}
          ${s.is_lost ? '<span class="badge priority-High">Lost</span>' : ''}
        </div>
        <button class="btn btn-ghost btn-small" data-edit='${JSON.stringify(s).replace(/'/g, "&#39;")}'>Edit</button>
      </div>`).join('');
  } else if (tab.key === 'courses') {
    listEl.innerHTML = rows.map((c) => `
      <div class="simple-list-row">
        <div><strong>${esc(c.name)}</strong> <span style="color:var(--ink-500);font-size:12.5px;">${esc(c.university_name || '')} · ${fmt.money(c.fees)} · ${esc(c.duration || '')}</span></div>
        <button class="btn btn-ghost btn-small" data-edit='${JSON.stringify(c).replace(/'/g, "&#39;")}'>Edit</button>
      </div>`).join('');
  } else {
    listEl.innerHTML = rows.map((r) => `
      <div class="simple-list-row">
        <div><strong>${esc(r.name)}</strong>${r.ad_name ? ` <span style="color:var(--ink-500);font-size:12.5px;">${esc(r.ad_name)}</span>` : ''}${r.country ? ` <span style="color:var(--ink-500);font-size:12.5px;">${esc(r.city || '')}, ${esc(r.country)}</span>` : ''}</div>
        <div style="display:flex;gap:8px;align-items:center;">
          ${r.is_active === false ? '<span class="badge priority-High">Inactive</span>' : ''}
          <button class="btn btn-ghost btn-small" data-edit='${JSON.stringify(r).replace(/'/g, "&#39;")}'>Edit</button>
        </div>
      </div>`).join('');
  }
  if (!rows.length) listEl.innerHTML = `<div class="empty-state"><h3>Nothing here yet</h3><p>Add your first ${tab.label.toLowerCase()}.</p></div>`;

  listEl.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.onclick = () => openSettingsFormModal(tab, JSON.parse(btn.dataset.edit));
  });
  document.getElementById('settings-add-btn').onclick = () => openSettingsFormModal(tab, null);
}

function settingsFieldsFor(key) {
  switch (key) {
    case 'statuses': return [
      { name: 'name', label: 'Status name' },
      { name: 'color', label: 'Color (hex)', type: 'color' },
      { name: 'sort_order', label: 'Sort order', type: 'number' },
      { name: 'is_won', label: 'Marks lead as Enrolled/Won', type: 'checkbox' },
      { name: 'is_lost', label: 'Marks lead as Lost', type: 'checkbox' },
    ];
    case 'sources': return [{ name: 'name', label: 'Source name' }];
    case 'campaigns': return [{ name: 'name', label: 'Campaign name' }, { name: 'ad_name', label: 'Ad name' }];
    case 'universities': return [
      { name: 'name', label: 'University name' },
      { name: 'city', label: 'City' },
      { name: 'country', label: 'Country' },
      { name: 'commission_type', label: 'Commission type', type: 'select', options: [{ value: 'percentage', label: 'Percentage of fee' }, { value: 'fixed', label: 'Fixed amount' }] },
      { name: 'commission_value', label: 'Commission value (% or ₹)', type: 'number' },
    ];
    case 'courses': return [
      { name: 'name', label: 'Course name' },
      { name: 'university_id', label: 'University', type: 'select', options: State.refData.universities.map((u) => ({ value: u.id, label: u.name })) },
      { name: 'specialization', label: 'Specialization' },
      { name: 'fees', label: 'Fees (INR)', type: 'number' },
      { name: 'duration', label: 'Duration' },
      { name: 'mode', label: 'Mode', type: 'select', options: [{ value: 'Online', label: 'Online' }, { value: 'Offline', label: 'Offline' }, { value: 'Hybrid', label: 'Hybrid' }] },
      { name: 'eligibility', label: 'Eligibility', type: 'textarea' },
    ];
    case 'tags': return [{ name: 'name', label: 'Tag name' }, { name: 'color', label: 'Color (hex)', type: 'color' }];
    default: return [{ name: 'name', label: 'Name' }];
  }
}

function openSettingsFormModal(tab, existing) {
  const fields = settingsFieldsFor(tab.key);
  const baseEndpoint = tab.key === 'courses' ? '/settings/courses' : tab.endpoint;
  const overlay = openModal(`
    <div class="modal-header"><h3>${existing ? 'Edit' : 'Add'} ${tab.label.replace(/s$/, '')}</h3><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-grid">
        ${fields.map((f) => `
          <div class="form-field ${f.type === 'textarea' ? 'span-2' : ''}">
            <label>${f.label}</label>
            ${f.type === 'select' ? `<select id="sf-${f.name}"><option value="">—</option>${f.options.map((o) => `<option value="${o.value}" ${existing?.[f.name] == o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
              : f.type === 'textarea' ? `<textarea id="sf-${f.name}">${esc(existing?.[f.name] || '')}</textarea>`
              : f.type === 'checkbox' ? `<input type="checkbox" id="sf-${f.name}" ${existing?.[f.name] ? 'checked' : ''} style="width:18px;height:18px;" />`
              : `<input type="${f.type || 'text'}" id="sf-${f.name}" value="${esc(existing?.[f.name] ?? (f.type === 'color' ? '#2A3EB1' : ''))}" />`}
          </div>
        `).join('')}
      </div>
    </div>
    <div class="modal-footer">
      ${existing ? `<button class="btn btn-danger" id="sf-delete" style="margin-right:auto;">Delete</button>` : ''}
      <button class="btn btn-ghost modal-close">Cancel</button>
      <button class="btn btn-primary" id="sf-save">Save</button>
    </div>
  `);
  overlay.querySelector('#sf-save').onclick = async () => {
    try {
      const payload = {};
      fields.forEach((f) => {
        const el = document.getElementById(`sf-${f.name}`);
        payload[f.name] = f.type === 'checkbox' ? el.checked : (el.value === '' ? null : el.value);
      });
      if (existing) await Api.patch(`${baseEndpoint}/${existing.id}`, payload);
      else await Api.post(baseEndpoint, payload);
      toast('Saved.');
      overlay.remove();
      await preloadRefData();
      router();
    } catch (err) { toast(err.message, 'error'); }
  };
  const delBtn = overlay.querySelector('#sf-delete');
  if (delBtn) delBtn.onclick = async () => {
    if (!(await confirmDialog('Delete this item? This cannot be undone.', { danger: true }))) return;
    try {
      await Api.del(`${baseEndpoint}/${existing.id}`);
      toast('Deleted.');
      overlay.remove();
      await preloadRefData();
      router();
    } catch (err) { toast(err.message, 'error'); }
  };
}

// =========================================================
// REPORTS PAGE
// =========================================================
const REPORT_TYPES = [
  { key: 'leads-over-time', label: 'Daily / Monthly Leads' },
  { key: 'source-performance', label: 'Source Performance' },
  { key: 'campaign-performance', label: 'Campaign Performance' },
  { key: 'counselor-performance', label: 'Counselor Performance' },
  { key: 'course-performance', label: 'Course Performance' },
  { key: 'enrollment', label: 'Enrollment Report' },
  { key: 'lost-leads', label: 'Lost Lead Report' },
  { key: 'followups', label: 'Follow-up Report' },
];

async function renderReportsPage(content) {
  content.innerHTML = `
    <div class="page-header"><div><h2>Reports</h2><div class="subtitle">Filter by date and export anything to CSV.</div></div></div>
    <div class="toolbar">
      <select id="report-type">${REPORT_TYPES.map((r) => `<option value="${r.key}">${r.label}</option>`).join('')}</select>
      <input type="date" id="report-from" />
      <input type="date" id="report-to" />
      <button class="btn btn-secondary" id="report-run">Run report</button>
      <button class="btn btn-ghost" id="report-export">Export CSV</button>
    </div>
    <div class="table-card" id="report-results"><div class="empty-state"><h3>Run a report</h3><p>Choose a report type and date range above.</p></div></div>
  `;
  function buildQuery() {
    const p = new URLSearchParams();
    const from = document.getElementById('report-from').value;
    const to = document.getElementById('report-to').value;
    if (from) p.set('dateFrom', from);
    if (to) p.set('dateTo', to);
    return p;
  }
  document.getElementById('report-run').onclick = async () => {
    const type = document.getElementById('report-type').value;
    const results = document.getElementById('report-results');
    results.innerHTML = `<div class="empty-state">Running…</div>`;
    const rows = await Api.get(`/reports/${type}?${buildQuery().toString()}`);
    if (!rows.length) { results.innerHTML = `<div class="empty-state"><h3>No data</h3><p>No records in this range.</p></div>`; return; }
    const cols = Object.keys(rows[0]);
    results.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr>${cols.map((c) => `<th>${esc(c.replace(/_/g, ' '))}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  };
  document.getElementById('report-export').onclick = () => {
    const type = document.getElementById('report-type').value;
    const q = buildQuery();
    q.set('format', 'csv');
    const url = `${Api.getBase()}/reports/${type}?${q.toString()}`;
    downloadWithAuth(url, `${type}.csv`);
  };
}

async function downloadWithAuth(url, filename) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${Api.getToken()}` } });
    if (!res.ok) { toast('Export failed.', 'error'); return; }
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  } catch (e) { toast('Export failed.', 'error'); }
}

// =========================================================
// COMMISSIONS PAGE
// =========================================================
async function renderCommissionsPage(content) {
  const [summary, rows] = await Promise.all([Api.get('/commissions/summary'), Api.get('/commissions')]);
  content.innerHTML = `
    <div class="page-header"><div><h2>Commissions</h2><div class="subtitle">Track what each university owes you, from enrollment to payout.</div></div></div>

    <div class="stats-grid">
      <div class="mini-stat"><div class="mini-number">${fmt.money(summary.pending_total)}</div><div class="mini-label">Pending (${summary.pending_count})</div></div>
      <div class="mini-stat"><div class="mini-number" style="color:var(--indigo-600)">${fmt.money(summary.invoiced_total)}</div><div class="mini-label">Invoiced (${summary.invoiced_count})</div></div>
      <div class="mini-stat"><div class="mini-number" style="color:var(--green-500)">${fmt.money(summary.received_total)}</div><div class="mini-label">Received (${summary.received_count})</div></div>
      <div class="mini-stat"><div class="mini-number">${fmt.money(Number(summary.pending_total) + Number(summary.invoiced_total) + Number(summary.received_total))}</div><div class="mini-label">Total commission (all-time)</div></div>
    </div>

    <div class="chart-card" style="margin-bottom:20px;">
      <h3>By university</h3>
      ${summary.byUniversity.length ? `
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>University</th><th>Enrollments</th><th>Total commission</th><th>Received</th></tr></thead>
          <tbody>${summary.byUniversity.map((u) => `
            <tr><td>${esc(u.university || 'Unassigned')}</td><td>${u.enrollments}</td><td>${fmt.money(u.total_commission)}</td><td>${fmt.money(u.received)}</td></tr>
          `).join('')}</tbody>
        </table></div>
      ` : `<p style="color:var(--ink-500);font-size:13px;">No commission records yet.</p>`}
    </div>

    <div class="table-card">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Lead</th><th>University</th><th>Enrollment amount</th><th>Commission</th><th>Status</th><th>Expected</th><th>Received</th><th>Actions</th></tr></thead>
          <tbody>
            ${rows.map((c) => `
              <tr>
                <td><a href="#/lead/${c.lead_id}">${esc(c.lead_name)}</a><br><small style="color:var(--ink-500)">${esc(c.lead_code)}</small></td>
                <td>${esc(c.university_name || '—')}</td>
                <td>${fmt.money(c.enrollment_amount)}</td>
                <td><strong>${fmt.money(c.commission_amount)}</strong></td>
                <td><span class="badge ${c.status === 'Received' ? '' : c.status === 'Invoiced' ? 'priority-Low' : 'priority-Medium'}" style="${c.status === 'Received' ? 'background:var(--green-100);color:var(--green-500);' : ''}">${esc(c.status)}</span></td>
                <td>${fmt.date(c.expected_date)}</td>
                <td>${fmt.date(c.received_date)}</td>
                <td>
                  ${c.status !== 'Received' ? `<select data-comm-status="${c.id}" style="font-size:12px;border:1px solid var(--line);border-radius:6px;padding:5px;">
                    <option value="">Update…</option>
                    ${c.status !== 'Invoiced' ? '<option value="Invoiced">Mark Invoiced</option>' : ''}
                    <option value="Received">Mark Received</option>
                  </select>` : '<span style="color:var(--green-500);font-size:12px;">✓ Paid</span>'}
                </td>
              </tr>
            `).join('') || `<tr><td colspan="8"><div class="empty-state"><h3>No commissions yet</h3><p>Add one from an enrolled lead's profile.</p></div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
  content.querySelectorAll('[data-comm-status]').forEach((sel) => sel.onchange = async () => {
    if (!sel.value) return;
    try {
      await Api.patch(`/commissions/${sel.dataset.commStatus}`, { status: sel.value });
      toast('Commission status updated.');
      renderCommissionsPage(content);
    } catch (err) { toast(err.message, 'error'); }
  });
}
