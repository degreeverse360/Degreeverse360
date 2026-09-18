/**
 * Degreeverse360 — Assignment Leads module
 * A separate lead type for assignment-writing services, alongside the main Leads module.
 */

const ASG_STATUSES = ['New', 'Contacted', 'Requirements Received', 'Payment Pending', 'In Progress', 'Assignment Ready', 'Delivered', 'Completed', 'Cancelled'];
const ASG_STATUS_COLORS = { New: '#2A3EB1', Contacted: '#3B4FD1', 'Requirements Received': '#7C5CFC', 'Payment Pending': '#F5A623', 'In Progress': '#F5A623', 'Assignment Ready': '#00B8A9', Delivered: '#1FAE6B', Completed: '#1FAE6B', Cancelled: '#9CA3AF' };

function deadlineInfo(dateStr) {
  if (!dateStr) return { label: 'No deadline set', cls: 'priority-Low' };
  const days = Math.ceil((new Date(dateStr).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (days < 0) return { label: `Overdue by ${Math.abs(days)}d`, cls: 'priority-High', days };
  if (days <= 2) return { label: days === 0 ? 'Due today' : `${days}d left — urgent`, cls: 'priority-High', days };
  if (days <= 7) return { label: `${days}d left`, cls: 'priority-Medium', days };
  return { label: `${days}d left`, cls: 'priority-Low', days };
}

function asgWaLink(lead) {
  const msg = `Hi ${lead.full_name} 👋\n\nThis is the Degreeverse team.\n\nWe understand that you are pursuing ${lead.pursuing || lead.course || 'your program'} from ${lead.university_name || 'your university'}${lead.semester ? `, currently in ${lead.semester}` : ''}.\n\nIf you need any help with your assignments, requirements, or submission process, feel free to connect with us. We'll be happy to assist you.\n\nRegards,\nTeam Degreeverse`;
  return `https://wa.me/${(lead.mobile || '').replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;
}

// =========================================================
// LIST / DASHBOARD
// =========================================================
async function renderAssignmentLeadsList(content, param, query) {
  const filters = { page: 1, pageSize: 25, ...query };

  content.innerHTML = skeletonRows(4);
  const [summary, res] = await Promise.all([
    Api.get('/assignment-leads/summary'),
    Api.get(`/assignment-leads?${new URLSearchParams(filters)}`),
  ]);

  content.innerHTML = `
    <div class="page-header">
      <div><h2>📚 Assignment Leads</h2><div class="subtitle">Track assignment-writing students, deadlines, and payments.</div></div>
      <div class="page-actions">
        <button class="btn btn-ghost" id="asg-upload-btn">Upload leads</button>
        <button class="btn btn-primary" id="asg-add-btn">+ Add lead</button>
      </div>
    </div>

    <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);">
      <div class="mini-stat"><div class="mini-number">${summary.total}</div><div class="mini-label">Total leads</div></div>
      <div class="mini-stat"><div class="mini-number" style="color:var(--indigo-600)">${summary.new_count}</div><div class="mini-label">New</div></div>
      <div class="mini-stat"><div class="mini-number" style="color:var(--amber-500)">${summary.in_progress}</div><div class="mini-label">In progress</div></div>
      <div class="mini-stat"><div class="mini-number" style="color:var(--green-500)">${summary.completed}</div><div class="mini-label">Completed</div></div>
      <div class="mini-stat"><div class="mini-number">${fmt.money(summary.total_revenue)}</div><div class="mini-label">Total revenue</div></div>
      <div class="mini-stat"><div class="mini-number" style="color:var(--coral-500)">${fmt.money(summary.pending_payments)}</div><div class="mini-label">Pending payments</div></div>
      <div class="mini-stat"><div class="mini-number">${summary.pending_followups}</div><div class="mini-label">Follow-ups due</div></div>
      <div class="mini-stat"><div class="mini-number" style="color:var(--coral-500)">${summary.overdue}</div><div class="mini-label">Overdue</div></div>
    </div>

    <div class="filter-chip-bar" id="asg-deadline-widgets">
      <button class="filter-chip" data-deadline="overdue" style="background:var(--coral-100);color:var(--coral-500);">🔴 ${summary.overdue} overdue</button>
      <button class="filter-chip" data-deadline="due_soon" style="background:var(--amber-100);color:var(--amber-500);">🟠 ${summary.due_soon} due in 1–2 days</button>
      <button class="filter-chip" data-deadline="this_week" style="background:var(--amber-100);color:var(--amber-500);">🟡 ${summary.due_week} due in 3–7 days</button>
      <button class="filter-chip" data-deadline="upcoming" style="background:var(--green-100);color:var(--green-500);">🟢 ${summary.upcoming} upcoming</button>
      ${filters.deadline ? `<button class="filter-chip" id="asg-clear-deadline">All ✕</button>` : ''}
    </div>

    <div class="toolbar">
      <input type="text" id="asg-search" placeholder="Search name, mobile, email, lead ID…" value="${esc(filters.search || '')}" style="min-width:220px;" />
      <select id="asg-status"><option value="">All statuses</option>${ASG_STATUSES.map((s) => `<option ${filters.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select id="asg-priority"><option value="">All priorities</option>${['High', 'Medium', 'Low'].map((p) => `<option ${filters.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
      <button class="btn btn-secondary btn-small" id="asg-apply">Apply</button>
      <button class="btn btn-ghost btn-small" id="asg-clear">Clear</button>
    </div>

    <div class="table-card">
      <div class="table-wrap" id="asg-table-wrap"></div>
      <div class="pagination-bar" id="asg-pagination"></div>
    </div>
  `;

  renderAsgTable(res, filters);

  document.getElementById('asg-add-btn').onclick = () => openAssignmentLeadFormModal();
  document.getElementById('asg-upload-btn').onclick = () => openAssignmentCsvWizard();
  document.querySelectorAll('#asg-deadline-widgets [data-deadline]').forEach((btn) => btn.onclick = () => {
    location.hash = `#/assignment-leads?${new URLSearchParams({ ...filters, deadline: btn.dataset.deadline, page: 1 })}`;
  });
  const clearDeadline = document.getElementById('asg-clear-deadline');
  if (clearDeadline) clearDeadline.onclick = () => {
    const { deadline, ...rest } = filters;
    location.hash = `#/assignment-leads?${new URLSearchParams(rest)}`;
  };
  document.getElementById('asg-apply').onclick = () => {
    const next = {
      ...filters,
      search: document.getElementById('asg-search').value.trim(),
      status: document.getElementById('asg-status').value,
      priority: document.getElementById('asg-priority').value,
      page: 1,
    };
    location.hash = `#/assignment-leads?${new URLSearchParams(Object.entries(next).filter(([, v]) => v))}`;
  };
  document.getElementById('asg-clear').onclick = () => { location.hash = '#/assignment-leads'; };
}

function renderAsgTable(res, filters) {
  const wrap = document.getElementById('asg-table-wrap');
  if (!res.data.length) {
    wrap.innerHTML = `<div class="empty-state"><h3>No assignment leads found</h3><p>Try adjusting your filters, or add one.</p></div>`;
    document.getElementById('asg-pagination').innerHTML = '';
    return;
  }
  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Student</th><th>University / Course</th><th>Assignments</th><th>Deal</th><th>Pending</th>
        <th>Deadline</th><th>Status</th><th>Counselor</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${res.data.map((l) => {
          const dl = deadlineInfo(l.last_submission_date);
          return `
          <tr>
            <td><div class="lead-name-cell"><strong data-open="${l.id}">${esc(l.full_name)}</strong><small>${esc(l.lead_code)} · ${esc(l.mobile)}</small></div></td>
            <td>${esc(l.course || '—')}<br><small style="color:var(--ink-500)">${esc(l.university_name || '')}${l.semester ? ' · ' + esc(l.semester) : ''}</small></td>
            <td>${l.assignment_count || 0}</td>
            <td>${fmt.money(l.deal_amount)}</td>
            <td style="color:${Number(l.pending_amount) > 0 ? 'var(--coral-500)' : 'var(--green-500)'};font-weight:600;">${fmt.money(l.pending_amount)}</td>
            <td><span class="badge ${dl.cls}">${dl.label}</span></td>
            <td><span class="badge" style="background:${ASG_STATUS_COLORS[l.status]}22;color:${ASG_STATUS_COLORS[l.status]}">${esc(l.status)}</span></td>
            <td>${l.counselor_name ? esc(l.counselor_name) : '<span style="color:var(--ink-500)">Unassigned</span>'}</td>
            <td><div class="action-icons">
              <button title="Call" data-call="${esc(l.mobile)}">📞</button>
              <button title="WhatsApp" data-wa="${esc(asgWaLink(l))}">💬</button>
              <button title="Open" data-open="${l.id}">👁️</button>
            </div></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
  wrap.querySelectorAll('[data-open]').forEach((el) => el.onclick = () => { location.hash = `#/assignment-lead/${el.dataset.open}`; });
  wrap.querySelectorAll('[data-call]').forEach((el) => el.onclick = () => { window.location.href = `tel:${el.dataset.call}`; });
  wrap.querySelectorAll('[data-wa]').forEach((el) => el.onclick = () => { window.open(el.dataset.wa, '_blank'); });

  const { page, pageSize, total } = res.pagination;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  document.getElementById('asg-pagination').innerHTML = `
    <span>${total} lead${total === 1 ? '' : 's'} · page ${page} of ${totalPages}</span>
    <div>
      <button class="btn btn-ghost" ${page <= 1 ? 'disabled' : ''} id="asg-pg-prev">Previous</button>
      <button class="btn btn-ghost" ${page >= totalPages ? 'disabled' : ''} id="asg-pg-next">Next</button>
    </div>`;
  const prevBtn = document.getElementById('asg-pg-prev');
  const nextBtn = document.getElementById('asg-pg-next');
  if (prevBtn) prevBtn.onclick = async () => renderAsgTable(await Api.get(`/assignment-leads?${new URLSearchParams({ ...filters, page: page - 1 })}`), { ...filters, page: page - 1 });
  if (nextBtn) nextBtn.onclick = async () => renderAsgTable(await Api.get(`/assignment-leads?${new URLSearchParams({ ...filters, page: page + 1 })}`), { ...filters, page: page + 1 });
}

// =========================================================
// ADD / EDIT FORM
// =========================================================
function openAssignmentLeadFormModal(existing = null) {
  const overlay = openModal(`
    <div class="modal-header"><h3>${existing ? 'Edit assignment lead' : 'Add assignment lead'}</h3><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <h4 style="font-size:12.5px;color:var(--ink-500);text-transform:uppercase;margin-bottom:10px;">Student details</h4>
      <div class="form-grid">
        <div class="form-field"><label>Full name *</label><input id="af-name" value="${esc(existing?.full_name || '')}" /></div>
        <div class="form-field"><label>Mobile *</label><input id="af-mobile" value="${esc(existing?.mobile || '')}" /></div>
        <div class="form-field span-2"><label>Email</label><input type="email" id="af-email" value="${esc(existing?.email || '')}" /></div>
      </div>
      <h4 style="font-size:12.5px;color:var(--ink-500);text-transform:uppercase;margin:18px 0 10px;">Academic details</h4>
      <div class="form-grid">
        <div class="form-field"><label>University name</label><input id="af-university" value="${esc(existing?.university_name || '')}" /></div>
        <div class="form-field"><label>Semester</label><input id="af-semester" value="${esc(existing?.semester || '')}" /></div>
        <div class="form-field"><label>Course</label><input id="af-course" value="${esc(existing?.course || '')}" /></div>
        <div class="form-field"><label>Pursuing (e.g. Assignment Writing)</label><input id="af-pursuing" value="${esc(existing?.pursuing || '')}" /></div>
      </div>
      <h4 style="font-size:12.5px;color:var(--ink-500);text-transform:uppercase;margin:18px 0 10px;">Assignment details</h4>
      <div class="form-grid">
        <div class="form-field"><label>Assignment count</label><input type="number" id="af-count" value="${existing?.assignment_count || ''}" /></div>
        <div class="form-field"><label>Last submission date</label><input type="date" id="af-deadline" value="${existing?.last_submission_date ? existing.last_submission_date.slice(0, 10) : ''}" /></div>
        <div class="form-field"><label>Status</label><select id="af-status">${ASG_STATUSES.map((s) => `<option ${(existing?.status || 'New') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="form-field"><label>Priority</label><select id="af-priority">${['Low', 'Medium', 'High'].map((p) => `<option ${(existing?.priority || 'Medium') === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="form-field span-2"><label>Assignment notes</label><textarea id="af-notes">${esc(existing?.assignment_notes || '')}</textarea></div>
      </div>
      <h4 style="font-size:12.5px;color:var(--ink-500);text-transform:uppercase;margin:18px 0 10px;">Payment details</h4>
      <div class="form-grid">
        <div class="form-field"><label>Deal amount (₹)</label><input type="number" id="af-deal" value="${existing?.deal_amount || 0}" /></div>
        <div class="form-field"><label>Amount already paid (₹)</label><input type="number" id="af-paid" value="${existing?.paid_amount || 0}" ${existing ? 'readonly title="Record new payments from the lead profile instead."' : ''} /></div>
        <div class="form-field"><label>Remaining amount</label><input type="text" id="af-remaining" value="${fmt.money((existing?.deal_amount || 0) - (existing?.paid_amount || 0))}" disabled /></div>
      </div>
      <p id="af-error" class="form-error" hidden></p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost modal-close">Cancel</button>
      <button class="btn btn-primary" id="af-save">${existing ? 'Save changes' : 'Create lead'}</button>
    </div>
  `, { wide: true });

  function recalc() {
    const deal = Number(document.getElementById('af-deal').value) || 0;
    const paid = Number(document.getElementById('af-paid').value) || 0;
    document.getElementById('af-remaining').value = fmt.money(deal - paid);
  }
  document.getElementById('af-deal').addEventListener('input', recalc);
  document.getElementById('af-paid').addEventListener('input', recalc);

  overlay.querySelector('#af-save').onclick = async () => saveAssignmentLead(overlay, existing);
}

async function saveAssignmentLead(overlay, existing, force = false) {
  const errEl = document.getElementById('af-error');
  errEl.hidden = true;
  const val = (id) => { const v = document.getElementById(id).value; return v === '' ? null : v; };
  const deal = Number(val('af-deal')) || 0;
  const paid = Number(val('af-paid')) || 0;
  if (paid > deal) { errEl.textContent = 'Paid amount cannot exceed the deal amount.'; errEl.hidden = false; return; }
  const payload = {
    full_name: val('af-name'), mobile: val('af-mobile'), email: val('af-email'),
    university_name: val('af-university'), semester: val('af-semester'), course: val('af-course'), pursuing: val('af-pursuing'),
    assignment_count: val('af-count'), last_submission_date: val('af-deadline'),
    status: val('af-status'), priority: val('af-priority'), assignment_notes: val('af-notes'),
    deal_amount: deal, paid_amount: paid,
  };
  if (!payload.full_name || !payload.mobile) { errEl.textContent = 'Full name and mobile are required.'; errEl.hidden = false; return; }
  if (force) payload.force = true;
  try {
    if (existing) {
      delete payload.paid_amount; // paid amount changes only via the payments endpoint
      await Api.patch(`/assignment-leads/${existing.id}`, payload);
      toast('Assignment lead updated.');
    } else {
      const res = await Api.post('/assignment-leads', payload);
      if (res && res.warning === 'duplicate_mobile') {
        const proceed = await confirmDialog(`${esc(res.message)} Create anyway?`);
        if (proceed) return saveAssignmentLead(overlay, existing, true);
        return;
      }
      toast(`Assignment lead ${res.lead_code} created.`);
    }
    overlay.remove();
    if (location.hash.startsWith('#/assignment-lead/')) router(); else location.hash = '#/assignment-leads';
  } catch (err) { errEl.textContent = err.message; errEl.hidden = false; }
}

// =========================================================
// CSV IMPORT WIZARD
// =========================================================
function sampleAssignmentCsv() {
  const header = 'Name,Mobile Number,Email,University Name,Semester,Course,Pursuing,Assignment Count,Deal Amount,Amount Paid,Last Date of Assignment Submission';
  const sample = 'Rohan Mehta,9876543210,rohan@example.com,Manipal University Jaipur,Semester 3,MBA,Assignment Writing,5,12000,7000,2026-09-25';
  const blob = new Blob([`${header}\n${sample}\n`], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'assignment-leads-sample.csv';
  link.click();
}

function openAssignmentCsvWizard() {
  const overlay = openModal(`
    <div class="modal-header"><h3>Upload assignment leads</h3><button class="modal-close">✕</button></div>
    <div class="modal-body" id="asg-csv-body">
      <p style="font-size:13px;color:var(--ink-500);margin-bottom:10px;">
        Columns: Name, Mobile Number, Email, University Name, Semester, Course, Pursuing, Assignment Count, Deal Amount, Amount Paid, Last Date of Assignment Submission (YYYY-MM-DD).
      </p>
      <button class="btn btn-ghost btn-small" id="asg-sample-btn" style="margin-bottom:14px;">Download sample CSV</button>
      <div class="dropzone" id="asg-dropzone">
        <input type="file" id="asg-file-input" accept=".csv" style="display:none;" />
        <div>📄 Click to choose a CSV file</div>
      </div>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost modal-close">Cancel</button></div>
  `, { wide: true });

  overlay.querySelector('#asg-sample-btn').onclick = sampleAssignmentCsv;
  const dropzone = overlay.querySelector('#asg-dropzone');
  const fileInput = overlay.querySelector('#asg-file-input');
  dropzone.onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const body = overlay.querySelector('#asg-csv-body');
    body.innerHTML = `<div class="empty-state">Validating file…</div>`;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const preview = await Api.postForm('/assignment-leads/csv/preview', formData);
      renderAsgCsvPreview(overlay, preview, file.name);
    } catch (err) { body.innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
  };
}

function renderAsgCsvPreview(overlay, preview, fileName) {
  const body = overlay.querySelector('#asg-csv-body');
  const footer = overlay.querySelector('.modal-footer');
  body.innerHTML = `
    <div class="import-summary">
      <div class="pill" style="background:var(--indigo-100);color:var(--indigo-600)">${preview.totalRows} total</div>
      <div class="pill" style="background:var(--green-100);color:var(--green-500)">${preview.validRows} valid</div>
      <div class="pill" style="background:var(--coral-100);color:var(--coral-500)">${preview.invalidRows} need attention</div>
    </div>
    <div class="table-wrap" style="max-height:340px;">
      <table class="data-table"><thead><tr><th>#</th><th>Name</th><th>Mobile</th><th>Status</th></tr></thead>
        <tbody>${preview.preview.slice(0, 200).map((p) => `
          <tr><td>${p.row}</td><td>${esc(p.data.Name || '')}</td><td>${esc(p.data['Mobile Number'] || '')}</td>
            <td>${p.errors.length ? `<span style="color:var(--coral-500);font-size:12px;">${p.errors.map(esc).join('; ')}</span>` : '<span style="color:var(--green-500);">✓ Valid</span>'}</td></tr>
        `).join('')}</tbody></table>
    </div>`;
  footer.innerHTML = `<button class="btn btn-ghost modal-close">Cancel</button><button class="btn btn-primary" id="asg-confirm-import">Import ${preview.validRows} valid rows</button>`;
  footer.querySelectorAll('.modal-close').forEach((b) => b.onclick = () => overlay.remove());
  footer.querySelector('#asg-confirm-import').onclick = async () => {
    const rows = preview.preview.filter((p) => p.valid).map((p) => p.data);
    if (!rows.length) { toast('No valid rows to import.', 'error'); return; }
    try {
      const res = await Api.post('/assignment-leads/csv/import', { rows, fileName });
      toast(`${res.imported} records processed successfully${res.failed ? `, ${res.failed} failed` : ''}.`);
      overlay.remove();
      router();
    } catch (err) { toast(err.message, 'error'); }
  };
}

// =========================================================
// PROFILE PAGE
// =========================================================
async function renderAssignmentLeadProfile(content, id) {
  const lead = await Api.get(`/assignment-leads/${id}`);
  const dl = deadlineInfo(lead.last_submission_date);

  content.innerHTML = `
    <a href="#/assignment-leads" style="font-size:13px;color:var(--ink-500);display:inline-block;margin-bottom:12px;">← Back to assignment leads</a>

    <div class="profile-header">
      <div class="name-block">
        <h2>${esc(lead.full_name)}</h2>
        <div class="code">"Assignment Lead" · ${esc(lead.lead_code)}</div>
        <div class="profile-meta-row">
          <div class="profile-meta-item"><span class="k">Course</span><span class="v">${esc(lead.course || '—')}</span></div>
          <div class="profile-meta-item"><span class="k">University</span><span class="v">${esc(lead.university_name || '—')}</span></div>
          <div class="profile-meta-item"><span class="k">Semester</span><span class="v">${esc(lead.semester || '—')}</span></div>
          <div class="profile-meta-item"><span class="k">Pursuing</span><span class="v">${esc(lead.pursuing || '—')}</span></div>
        </div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" onclick="window.location.href='tel:${esc(lead.mobile)}'">📞 Call</button>
        <button class="btn btn-ghost" id="ap-wa-btn">💬 WhatsApp</button>
        <button class="btn btn-secondary" id="ap-edit-btn">Edit</button>
      </div>
    </div>

    <div class="hero-stats" style="grid-template-columns:repeat(4,1fr);margin-bottom:18px;">
      <div class="stat-tile"><div class="stat-number">${fmt.money(lead.deal_amount)}</div><div class="stat-label">Deal amount</div></div>
      <div class="stat-tile"><div class="stat-number" style="color:var(--green-500)">${fmt.money(lead.paid_amount)}</div><div class="stat-label">Paid amount</div></div>
      <div class="stat-tile ${Number(lead.pending_amount) > 0 ? 'danger' : ''}"><div class="stat-number">${fmt.money(lead.pending_amount)}</div><div class="stat-label">Pending amount</div></div>
      <div class="stat-tile ${dl.cls === 'priority-High' ? 'danger' : dl.cls === 'priority-Medium' ? 'warn' : ''}"><div class="stat-number" style="font-size:20px;">${dl.label}</div><div class="stat-label">${lead.assignment_count || 0} assignments · ${fmt.date(lead.last_submission_date)}</div></div>
    </div>

    <div class="profile-grid">
      <div>
        <div class="info-card">
          <h4>Quick actions</h4>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button class="btn btn-secondary btn-small" id="qa-followup">📅 Add follow-up</button>
            <button class="btn btn-secondary btn-small" id="qa-note">📝 Add note</button>
            <button class="btn btn-secondary btn-small" id="qa-item">📄 Add assignment</button>
            <button class="btn btn-secondary btn-small" id="qa-payment">💰 Update payment</button>
            <button class="btn btn-secondary btn-small" id="qa-status">🔄 Change status</button>
          </div>
        </div>
        <div class="info-card">
          <h4>Details</h4>
          <div class="info-row"><span class="k">Email</span><span class="v">${esc(lead.email || '—')}</span></div>
          <div class="info-row"><span class="k">Mobile</span><span class="v">${esc(lead.mobile)}</span></div>
          <div class="info-row"><span class="k">Status</span><span class="v"><span class="badge" style="background:${ASG_STATUS_COLORS[lead.status]}22;color:${ASG_STATUS_COLORS[lead.status]}">${esc(lead.status)}</span></span></div>
          <div class="info-row"><span class="k">Priority</span><span class="v"><span class="badge priority-${lead.priority}">${esc(lead.priority)}</span></span></div>
          <div class="info-row"><span class="k">Counselor</span><span class="v">${esc(lead.counselor_name || 'Unassigned')}</span></div>
        </div>
        ${lead.assignment_notes ? `<div class="info-card"><h4>Assignment notes</h4><p style="font-size:13px;color:var(--ink-700);margin:0;">${esc(lead.assignment_notes)}</p></div>` : ''}
      </div>
      <div>
        <div class="tabs" id="ap-tabs">
          <button class="tab-btn active" data-tab="overview">Overview</button>
          <button class="tab-btn" data-tab="assignments">Assignments (${lead.items.length})</button>
          <button class="tab-btn" data-tab="followups">Follow-ups (${lead.followups.length})</button>
          <button class="tab-btn" data-tab="documents">Documents (${lead.documents.length})</button>
          <button class="tab-btn" data-tab="notes">Notes (${lead.notes.length})</button>
          <button class="tab-btn" data-tab="activity">Activity</button>
        </div>
        <div id="ap-tab-content"></div>
      </div>
    </div>
  `;

  document.getElementById('ap-edit-btn').onclick = () => openAssignmentLeadFormModal(lead);
  document.getElementById('ap-wa-btn').onclick = () => openAsgWhatsappModal(lead);
  document.getElementById('qa-followup').onclick = () => openAsgFollowupModal(lead.id, () => router());
  document.getElementById('qa-note').onclick = () => openAsgNoteModal(lead.id, () => router());
  document.getElementById('qa-item').onclick = () => openAsgItemModal(lead.id, null, () => router());
  document.getElementById('qa-payment').onclick = () => openAsgPaymentModal(lead, () => router());
  document.getElementById('qa-status').onclick = () => openAsgStatusModal(lead, () => router());

  const tabContent = document.getElementById('ap-tab-content');
  function renderTab(tab) {
    document.querySelectorAll('#ap-tabs .tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'overview') {
      tabContent.innerHTML = `
        <div class="info-card" style="margin:0;">
          <h4>Payment history</h4>
          ${lead.payments.length ? lead.payments.map((p) => `
            <div class="info-row"><span class="k">${fmt.date(p.payment_date)} · ${esc(p.payment_method || '—')}</span><span class="v">${fmt.money(p.amount)}</span></div>
          `).join('') : '<p style="color:var(--ink-500);font-size:13px;">No payments recorded yet.</p>'}
        </div>`;
    } else if (tab === 'assignments') {
      tabContent.innerHTML = `
        <button class="btn btn-secondary btn-small" id="add-item-btn" style="margin-bottom:12px;">+ Add assignment</button>
        ${lead.items.length ? `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Assignment</th><th>Subject</th><th>Due</th><th>Status</th><th>File</th><th></th></tr></thead>
          <tbody>${lead.items.map((it) => `
            <tr>
              <td>${esc(it.title)}</td><td>${esc(it.subject || '—')}</td><td>${fmt.date(it.due_date)}</td>
              <td><select data-item-status="${it.id}" style="font-size:12px;border:1px solid var(--line);border-radius:6px;padding:4px;">
                ${['Pending', 'In Progress', 'Completed'].map((s) => `<option ${it.status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select></td>
              <td>${it.file_url ? `<a href="${esc(it.file_url)}" target="_blank">View</a>` : '—'}</td>
              <td><button class="btn btn-ghost btn-small" data-edit-item="${it.id}">${it.file_url ? 'Replace' : 'Upload'}</button></td>
            </tr>
          `).join('')}</tbody>
        </table></div>` : '<div class="empty-state"><h3>No assignments added yet</h3></div>'}
      `;
      document.getElementById('add-item-btn').onclick = () => openAsgItemModal(lead.id, null, () => router());
      tabContent.querySelectorAll('[data-item-status]').forEach((sel) => sel.onchange = async () => {
        await Api.patch(`/assignment-leads/items/${sel.dataset.itemStatus}`, { status: sel.value });
        toast('Assignment status updated.');
        router();
      });
      tabContent.querySelectorAll('[data-edit-item]').forEach((btn) => btn.onclick = () => {
        const item = lead.items.find((it) => it.id == btn.dataset.editItem);
        openAsgItemModal(lead.id, item, () => router());
      });
    } else if (tab === 'followups') {
      tabContent.innerHTML = `
        <button class="btn btn-secondary btn-small" id="add-fu-btn" style="margin-bottom:12px;">+ Add follow-up</button>
        ${lead.followups.length ? lead.followups.map((f) => `
          <div class="followup-item ${f.status === 'Pending' && new Date(f.scheduled_date) < new Date().setHours(0, 0, 0, 0) ? 'overdue' : ''}">
            <div>
              <div class="fu-main">${esc(f.followup_type)} · ${fmt.date(f.scheduled_date)} ${fmt.time(f.scheduled_time)}</div>
              <div class="fu-sub">${esc(f.notes || '')} · ${esc(f.status)}</div>
            </div>
            ${f.status === 'Pending' ? `<div style="display:flex;gap:6px;">
              <button class="btn btn-success btn-small" data-complete-fu="${f.id}">Complete</button>
              <button class="btn btn-ghost btn-small" data-miss-fu="${f.id}">Missed</button>
            </div>` : ''}
          </div>
        `).join('') : '<div class="empty-state"><h3>No follow-ups yet</h3></div>'}
      `;
      document.getElementById('add-fu-btn').onclick = () => openAsgFollowupModal(lead.id, () => router());
      tabContent.querySelectorAll('[data-complete-fu]').forEach((b) => b.onclick = async () => { await Api.patch(`/assignment-leads/followups/${b.dataset.completeFu}`, { status: 'Completed' }); toast('Marked complete.'); router(); });
      tabContent.querySelectorAll('[data-miss-fu]').forEach((b) => b.onclick = async () => { await Api.patch(`/assignment-leads/followups/${b.dataset.missFu}`, { status: 'Missed' }); toast('Marked missed.'); router(); });
    } else if (tab === 'documents') {
      tabContent.innerHTML = `
        <button class="btn btn-secondary btn-small" id="add-doc-btn" style="margin-bottom:12px;">+ Add document link</button>
        ${lead.documents.length ? lead.documents.map((d) => `
          <div class="simple-list-row">
            <div><strong>${esc(d.doc_name)}</strong> <span style="color:var(--ink-500);font-size:12px;">${esc(d.doc_type || '')} · by ${esc(d.uploaded_by_name || '')} · ${fmt.date(d.uploaded_at)}</span></div>
            <div style="display:flex;gap:8px;"><a class="btn btn-ghost btn-small" href="${esc(d.file_url)}" target="_blank">Download</a><button class="btn btn-danger btn-small" data-del-doc="${d.id}">Delete</button></div>
          </div>
        `).join('') : '<div class="empty-state"><h3>No documents yet</h3></div>'}
      `;
      document.getElementById('add-doc-btn').onclick = () => openAsgDocumentModal(lead.id, () => router());
      tabContent.querySelectorAll('[data-del-doc]').forEach((b) => b.onclick = async () => {
        if (!(await confirmDialog('Remove this document?'))) return;
        await Api.del(`/assignment-leads/documents/${b.dataset.delDoc}`); toast('Removed.'); router();
      });
    } else if (tab === 'notes') {
      tabContent.innerHTML = `
        <button class="btn btn-secondary btn-small" id="add-note-btn2" style="margin-bottom:12px;">+ Add note</button>
        ${lead.notes.length ? lead.notes.map((n) => `
          <div class="note-item"><div class="note-head"><span>${esc(n.created_by_name || '')} · ${fmt.dateTime(n.created_at)}</span></div><div>${esc(n.content)}</div></div>
        `).join('') : '<div class="empty-state"><h3>No internal notes yet</h3></div>'}
      `;
      document.getElementById('add-note-btn2').onclick = () => openAsgNoteModal(lead.id, () => router());
    } else if (tab === 'activity') {
      tabContent.innerHTML = `<ul class="timeline">
        ${lead.activities.length ? lead.activities.map((a) => `
          <li><div class="timeline-dot"></div><div class="timeline-content">
            <div>${describeAsgActivity(a)}</div><div class="meta">${esc(a.user_name || 'System')} · ${fmt.dateTime(a.created_at)}</div>
          </div></li>
        `).join('') : '<li><div class="timeline-content">No activity recorded yet.</div></li>'}
      </ul>`;
    }
  }
  document.querySelectorAll('#ap-tabs .tab-btn').forEach((b) => b.onclick = () => renderTab(b.dataset.tab));
  renderTab('overview');
}

function describeAsgActivity(a) {
  const map = {
    lead_created: 'Lead was created', assigned: 'Assigned to a counselor', reassigned: 'Reassigned counselor',
    status_changed: `Status changed from ${a.old_value || '—'} to ${a.new_value || '—'}`,
    payment_updated: a.new_value || 'Payment updated',
    assignment_added: `Assignment added: ${a.new_value || ''}`,
    assignment_status_changed: a.new_value || 'Assignment status changed',
    assignment_file_uploaded: `File uploaded for ${a.new_value || 'an assignment'}`,
    followup_created: `Follow-up scheduled: ${a.new_value || ''}`,
    note_added: 'Note added',
  };
  return map[a.action] || (a.action || '').replace(/_/g, ' ');
}

// =========================================================
// SMALL MODALS: WhatsApp, follow-up, note, item, document, payment, status
// =========================================================
function openAsgWhatsappModal(lead) {
  const msg = `Hi ${lead.full_name} 👋\n\nThis is the Degreeverse team.\n\nWe understand that you are pursuing ${lead.pursuing || lead.course || 'your program'} from ${lead.university_name || 'your university'}${lead.semester ? `, currently in ${lead.semester}` : ''}.\n\nIf you need any help with your assignments, requirements, or submission process, feel free to connect with us. We'll be happy to assist you.\n\nRegards,\nTeam Degreeverse`;
  const overlay = openModal(`
    <div class="modal-header"><h3>Send WhatsApp message</h3><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-field"><label>Message (edit as needed)</label><textarea id="wa-msg" style="min-height:180px;">${esc(msg)}</textarea></div>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost modal-close">Cancel</button><button class="btn btn-primary" id="wa-send">Open WhatsApp</button></div>
  `, { wide: true });
  overlay.querySelector('#wa-send').onclick = () => {
    window.open(`https://wa.me/${(lead.mobile || '').replace(/\D/g, '')}?text=${encodeURIComponent(document.getElementById('wa-msg').value)}`, '_blank');
    overlay.remove();
  };
}

function openAsgFollowupModal(leadId, onDone) {
  const overlay = openModal(`
    <div class="modal-header"><h3>Add follow-up</h3><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="form-field"><label>Date *</label><input type="date" id="afu-date" /></div>
        <div class="form-field"><label>Time</label><input type="time" id="afu-time" /></div>
        <div class="form-field span-2"><label>Type</label><select id="afu-type">${['Call', 'WhatsApp', 'Email', 'Other'].map((t) => `<option>${t}</option>`).join('')}</select></div>
        <div class="form-field span-2"><label>Notes</label><textarea id="afu-notes"></textarea></div>
      </div>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost modal-close">Cancel</button><button class="btn btn-primary" id="afu-save">Save</button></div>
  `);
  overlay.querySelector('#afu-save').onclick = async () => {
    const date = document.getElementById('afu-date').value;
    if (!date) { toast('Pick a date.', 'error'); return; }
    try {
      await Api.post(`/assignment-leads/${leadId}/followups`, { scheduled_date: date, scheduled_time: document.getElementById('afu-time').value || null, followup_type: document.getElementById('afu-type').value, notes: document.getElementById('afu-notes').value || null });
      toast('Follow-up scheduled.'); overlay.remove(); onDone();
    } catch (err) { toast(err.message, 'error'); }
  };
}

function openAsgNoteModal(leadId, onDone) {
  const overlay = openModal(`
    <div class="modal-header"><h3>Add internal note</h3><button class="modal-close">✕</button></div>
    <div class="modal-body"><div class="form-field"><label>Note *</label><textarea id="an-content" placeholder="Visible to your CRM team only"></textarea></div></div>
    <div class="modal-footer"><button class="btn btn-ghost modal-close">Cancel</button><button class="btn btn-primary" id="an-save">Save</button></div>
  `);
  overlay.querySelector('#an-save').onclick = async () => {
    const content = document.getElementById('an-content').value.trim();
    if (!content) { toast('Write something first.', 'error'); return; }
    try { await Api.post(`/assignment-leads/${leadId}/notes`, { content }); toast('Note added.'); overlay.remove(); onDone(); }
    catch (err) { toast(err.message, 'error'); }
  };
}

function openAsgItemModal(leadId, existing, onDone) {
  const overlay = openModal(`
    <div class="modal-header"><h3>${existing ? 'Update assignment' : 'Add assignment'}</h3><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="form-field"><label>Title *</label><input id="ai-title" value="${esc(existing?.title || '')}" placeholder="Assignment 1" /></div>
        <div class="form-field"><label>Subject</label><input id="ai-subject" value="${esc(existing?.subject || '')}" /></div>
        <div class="form-field"><label>Due date</label><input type="date" id="ai-due" value="${existing?.due_date ? existing.due_date.slice(0, 10) : ''}" /></div>
        <div class="form-field"><label>Status</label><select id="ai-status">${['Pending', 'In Progress', 'Completed'].map((s) => `<option ${(existing?.status || 'Pending') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="form-field span-2"><label>File link (Google Drive, etc.)</label><input id="ai-file" value="${esc(existing?.file_url || '')}" placeholder="https://…" /></div>
      </div>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost modal-close">Cancel</button><button class="btn btn-primary" id="ai-save">Save</button></div>
  `);
  overlay.querySelector('#ai-save').onclick = async () => {
    const title = document.getElementById('ai-title').value.trim();
    if (!title) { toast('Title is required.', 'error'); return; }
    const payload = { title, subject: document.getElementById('ai-subject').value || null, due_date: document.getElementById('ai-due').value || null, status: document.getElementById('ai-status').value, file_url: document.getElementById('ai-file').value || null };
    try {
      if (existing) await Api.patch(`/assignment-leads/items/${existing.id}`, payload);
      else await Api.post(`/assignment-leads/${leadId}/items`, payload);
      toast('Saved.'); overlay.remove(); onDone();
    } catch (err) { toast(err.message, 'error'); }
  };
}

function openAsgDocumentModal(leadId, onDone) {
  const overlay = openModal(`
    <div class="modal-header"><h3>Add document</h3><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="form-field"><label>Document name *</label><input id="ad-name" placeholder="e.g. Assignment Requirements" /></div>
        <div class="form-field"><label>Type</label><select id="ad-type">${['Question Paper', 'Assignment Requirements', 'Student Document', 'Completed Assignment', 'Submission Proof', 'Payment Receipt'].map((t) => `<option>${t}</option>`).join('')}</select></div>
        <div class="form-field span-2"><label>File link *</label><input id="ad-url" placeholder="https://drive.google.com/…" /></div>
      </div>
      <p style="font-size:12px;color:var(--ink-500);margin-top:6px;">Paste a link to the file (Google Drive, Dropbox, etc.) — direct upload isn't set up yet.</p>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost modal-close">Cancel</button><button class="btn btn-primary" id="ad-save">Save</button></div>
  `);
  overlay.querySelector('#ad-save').onclick = async () => {
    const doc_name = document.getElementById('ad-name').value.trim();
    const file_url = document.getElementById('ad-url').value.trim();
    if (!doc_name || !file_url) { toast('Name and file link are required.', 'error'); return; }
    try {
      await Api.post(`/assignment-leads/${leadId}/documents`, { doc_name, doc_type: document.getElementById('ad-type').value, file_url });
      toast('Document added.'); overlay.remove(); onDone();
    } catch (err) { toast(err.message, 'error'); }
  };
}

function openAsgPaymentModal(lead, onDone) {
  const overlay = openModal(`
    <div class="modal-header"><h3>Record payment</h3><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <p style="font-size:12.5px;color:var(--ink-500);margin-bottom:12px;">Pending: <strong>${fmt.money(lead.pending_amount)}</strong> of ${fmt.money(lead.deal_amount)}</p>
      <div class="form-grid">
        <div class="form-field"><label>Amount received (₹) *</label><input type="number" id="ap-amount" /></div>
        <div class="form-field"><label>Payment date</label><input type="date" id="ap-date" value="${new Date().toISOString().slice(0, 10)}" /></div>
        <div class="form-field span-2"><label>Method</label><select id="ap-method">${['UPI', 'Cash', 'Bank Transfer', 'Card', 'Other'].map((m) => `<option>${m}</option>`).join('')}</select></div>
        <div class="form-field span-2"><label>Notes</label><textarea id="ap-notes"></textarea></div>
      </div>
      <p id="ap-error" class="form-error" hidden></p>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost modal-close">Cancel</button><button class="btn btn-primary" id="ap-save">Save payment</button></div>
  `);
  overlay.querySelector('#ap-save').onclick = async () => {
    const amount = document.getElementById('ap-amount').value;
    const errEl = document.getElementById('ap-error');
    if (!amount || Number(amount) <= 0) { errEl.textContent = 'Enter a valid amount.'; errEl.hidden = false; return; }
    try {
      await Api.post(`/assignment-leads/${lead.id}/payments`, { amount, payment_date: document.getElementById('ap-date').value, payment_method: document.getElementById('ap-method').value, notes: document.getElementById('ap-notes').value || null });
      toast('Payment recorded.'); overlay.remove(); onDone();
    } catch (err) { errEl.textContent = err.message; errEl.hidden = false; }
  };
}

function openAsgStatusModal(lead, onDone) {
  const overlay = openModal(`
    <div class="modal-header"><h3>Change status</h3><button class="modal-close">✕</button></div>
    <div class="modal-body"><div class="form-field"><label>New status</label><select id="as-status">${ASG_STATUSES.map((s) => `<option ${lead.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>
    <div class="modal-footer"><button class="btn btn-ghost modal-close">Cancel</button><button class="btn btn-primary" id="as-save">Update</button></div>
  `);
  overlay.querySelector('#as-save').onclick = async () => {
    try { await Api.patch(`/assignment-leads/${lead.id}`, { status: document.getElementById('as-status').value }); toast('Status updated.'); overlay.remove(); onDone(); }
    catch (err) { toast(err.message, 'error'); }
  };
}
