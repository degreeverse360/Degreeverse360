/**
 * Degreeverse360 — Leads list, Lead profile, Lead create/edit form, CSV import
 */

// =========================================================
// LEADS LIST
// =========================================================
async function renderLeadsList(content, param, query) {
  if (Object.keys(query).length === 0) {
    const saved = localStorage.getItem('dgv_lead_filters');
    if (saved && saved !== '{}') {
      location.hash = `#/leads?${saved}`;
      return;
    }
  }
  const filters = { page: 1, pageSize: 25, ...query };
  State.leadFilters = filters;
  localStorage.setItem('dgv_lead_filters', new URLSearchParams(query).toString());

  content.innerHTML = `
    <div class="page-header">
      <div><h2>Leads</h2><div class="subtitle">Every inquiry, from first contact to enrollment.</div></div>
      <div class="page-actions">
        <button class="btn btn-ghost" id="csv-import-btn">Import CSV</button>
        <button class="btn btn-ghost" id="csv-export-btn">Export CSV</button>
        <button class="btn btn-primary" id="add-lead-btn">+ Add lead</button>
      </div>
    </div>

    <div class="settings-tabs" id="status-tabs" style="overflow-x:auto;flex-wrap:nowrap;padding-bottom:4px;">
      <button class="settings-tab ${!filters.status ? 'active' : ''}" data-status="" style="white-space:nowrap;">All leads</button>
      ${State.refData.statuses.map((s) => `
        <button class="settings-tab ${filters.status === s.name ? 'active' : ''}" data-status="${esc(s.name)}" style="white-space:nowrap;">${esc(s.name)}</button>
      `).join('')}
    </div>

    <div class="toolbar">
      <input type="text" id="f-search" placeholder="Search…" value="${esc(filters.search || '')}" style="min-width:200px;" />
      <select id="f-source"><option value="">All sources</option>${State.refData.sources.map((s) => `<option value="${esc(s.name)}" ${filters.source === s.name ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      ${State.user.role !== 'counselor' ? `<select id="f-counselor"><option value="">All counselors</option>${State.refData.counselors.map((c) => `<option value="${c.id}" ${filters.counselor == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : ''}
      <select id="f-priority"><option value="">All priorities</option>${['High', 'Medium', 'Low'].map((p) => `<option ${filters.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
      <button class="btn btn-secondary btn-small" id="f-apply">Apply</button>
      <button class="btn btn-ghost btn-small" id="f-clear">Clear</button>
    </div>

    <div class="table-card">
      <div class="table-wrap" id="leads-table-wrap">${skeletonRows(6)}</div>
      <div class="pagination-bar" id="leads-pagination"></div>
    </div>
  `;

  document.querySelectorAll('#status-tabs .settings-tab').forEach((btn) => {
    btn.onclick = () => {
      const next = { ...filters, status: btn.dataset.status || undefined, page: 1 };
      const q = new URLSearchParams(Object.entries(next).filter(([k, v]) => v && k !== 'pageSize'));
      location.hash = `#/leads?${q.toString()}`;
    };
  });

  document.getElementById('add-lead-btn').onclick = () => openLeadFormModal();
  document.getElementById('csv-import-btn').onclick = () => openCsvImportWizard();
  document.getElementById('csv-export-btn').onclick = () => {
    const q = buildLeadQuery({ ...filters, page: undefined, pageSize: undefined });
    downloadWithAuth(`${Api.getBase()}/csv/export?${q.toString()}`, 'degreeverse360-leads.csv');
  };
  document.getElementById('f-apply').onclick = () => applyFilters();
  document.getElementById('f-clear').onclick = () => { localStorage.removeItem('dgv_lead_filters'); location.hash = '#/leads'; };
  ['f-search'].forEach((id) => document.getElementById(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFilters(); }));

  function applyFilters() {
    const next = {
      search: document.getElementById('f-search').value.trim(),
      status: filters.status || '',
      source: document.getElementById('f-source').value,
      counselor: State.user.role !== 'counselor' ? document.getElementById('f-counselor').value : '',
      priority: document.getElementById('f-priority').value,
    };
    const q = new URLSearchParams(Object.entries(next).filter(([, v]) => v));
    location.hash = `#/leads?${q.toString()}`;
  }

  await loadLeadsTable(filters);
}

function waLink(number, name, courseName) {
  const msg = `Hi ${name}, this is Degreeverse360 following up on your interest in ${courseName || 'our programs'}. Do you have a few minutes to talk?`;
  return `https://wa.me/${(number || '').replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;
}

function leadAgeBadge(lead) {
  const refDate = lead.last_contacted_date || lead.created_at;
  const days = Math.floor((Date.now() - new Date(refDate).getTime()) / 86400000);
  let cls, label;
  if (!lead.last_contacted_date) { cls = 'priority-Low'; label = 'Never contacted'; }
  else if (days <= 2) { cls = 'priority-Low'; label = `${days}d ago`; }
  else if (days <= 6) { cls = 'priority-Medium'; label = `${days}d ago`; }
  else { cls = 'priority-High'; label = `${days}d ago`; }
  return `<span class="badge ${cls}" title="Last contact: ${fmt.date(refDate)}">${label}</span>`;
}

function sortArrow(filters, field) {
  if (filters.sortBy !== field) return '<span style="opacity:.3;">↕</span>';
  return filters.sortDir === 'desc' ? '↓' : '↑';
}

function buildLeadQuery(filters) {
  const q = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== '' && v !== null) q.set(k, v); });
  return q;
}

async function loadLeadsTable(filters) {
  const wrap = document.getElementById('leads-table-wrap');
  wrap.innerHTML = skeletonRows(6);
  const q = buildLeadQuery(filters);
  const res = await Api.get(`/leads?${q.toString()}`);
  State.leadsCache = res;

  if (!res.data.length) {
    wrap.innerHTML = `<div class="empty-state"><h3>No leads found</h3><p>Try adjusting your filters, or add a new lead.</p></div>`;
    document.getElementById('leads-pagination').innerHTML = '';
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th data-sort="full_name" style="cursor:pointer;">Lead ${sortArrow(filters, 'full_name')}</th>
        <th>Course / University</th><th>Source</th><th>Status</th><th>Priority</th>
        <th>Counselor</th><th>Last contact</th>
        <th data-sort="next_followup_date" style="cursor:pointer;">Next follow-up ${sortArrow(filters, 'next_followup_date')}</th>
        <th>Actions</th>
      </tr></thead>
      <tbody>
        ${res.data.map((l) => `
          <tr>
            <td style="padding:0;"><div class="swipe-wrap" data-swipe-row>
              <div class="swipe-actions">
                <button class="swipe-call" data-call="${esc(l.mobile)}">📞</button>
                <button class="swipe-wa" data-wa-link="${esc(waLink(l.whatsapp_number || l.mobile, l.full_name, l.course_name))}">💬</button>
              </div>
              <div class="swipe-content lead-name-cell" style="padding:12px 14px;">
                <strong data-open-lead="${l.id}">${esc(l.full_name)}</strong>
                <small>${esc(l.lead_code)} · ${esc(l.mobile)}</small>
              </div>
            </div></td>
            <td>${esc(l.course_name || '—')}<br><small style="color:var(--ink-500)">${esc(l.university_name || '')}</small></td>
            <td>${esc(l.source_name || '—')}</td>
            <td><span class="badge" style="background:${l.status_color}22;color:${l.status_color}">${esc(l.status_name)}</span></td>
            <td><span class="badge priority-${l.priority}">${esc(l.priority)}</span></td>
            <td>${l.counselor_name ? `<span class="badge" style="background:${l.counselor_color}22;color:${l.counselor_color}">${esc(l.counselor_name)}</span>` : '<span style="color:var(--ink-500)">Unassigned</span>'}</td>
            <td>${leadAgeBadge(l)}</td>
            <td>${l.next_followup_date ? fmt.date(l.next_followup_date) + ' ' + fmt.time(l.next_followup_time) : '—'}</td>
            <td><div class="action-icons">
              <button title="Call" data-call="${esc(l.mobile)}">📞</button>
              <button title="WhatsApp" data-wa-link="${esc(waLink(l.whatsapp_number || l.mobile, l.full_name, l.course_name))}">💬</button>
              <button title="Open" data-open-lead="${l.id}">👁️</button>
            </div></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll('[data-open-lead]').forEach((el) => el.onclick = () => { location.hash = `#/lead/${el.dataset.openLead}`; });
  wrap.querySelectorAll('[data-call]').forEach((el) => el.onclick = () => { window.location.href = `tel:${el.dataset.call}`; });
  wrap.querySelectorAll('[data-wa-link]').forEach((el) => el.onclick = () => { window.open(el.dataset.waLink, '_blank'); });
  wrap.querySelectorAll('th[data-sort]').forEach((th) => th.onclick = () => {
    const field = th.dataset.sort;
    const nextDir = (filters.sortBy === field && filters.sortDir !== 'desc') ? 'desc' : 'asc';
    loadLeadsTable({ ...filters, sortBy: field, sortDir: nextDir, page: 1 });
  });
  wireSwipeRows(wrap);

  const { page, pageSize, total } = res.pagination;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  document.getElementById('leads-pagination').innerHTML = `
    <span>${total} lead${total === 1 ? '' : 's'} · page ${page} of ${totalPages}</span>
    <div>
      <button class="btn btn-ghost" ${page <= 1 ? 'disabled' : ''} id="pg-prev">Previous</button>
      <button class="btn btn-ghost" ${page >= totalPages ? 'disabled' : ''} id="pg-next">Next</button>
    </div>`;
  const prevBtn = document.getElementById('pg-prev');
  const nextBtn = document.getElementById('pg-next');
  if (prevBtn) prevBtn.onclick = () => loadLeadsTable({ ...filters, page: page - 1 });
  if (nextBtn) nextBtn.onclick = () => loadLeadsTable({ ...filters, page: page + 1 });
}

function wireSwipeRows(wrap) {
  wrap.querySelectorAll('[data-swipe-row]').forEach((row) => {
    const contentEl = row.querySelector('.swipe-content');
    let startX = 0, startY = 0, dragging = false, horizontal = null;
    row.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX; startY = e.touches[0].clientY;
      dragging = true; horizontal = null;
    }, { passive: true });
    row.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (horizontal === null) horizontal = Math.abs(dx) > Math.abs(dy) + 4;
      if (!horizontal) return;
      e.preventDefault();
      if (dx < -10) contentEl.classList.add('open');
      else if (dx > 10) contentEl.classList.remove('open');
    }, { passive: false });
    row.addEventListener('touchend', () => { dragging = false; });
  });
}

// =========================================================
// LEAD CREATE / EDIT FORM
// =========================================================
function openLeadFormModal(existing = null) {
  const r = State.refData;
  const overlay = openModal(`
    <div class="modal-header"><h3>${existing ? 'Edit lead' : 'Add new lead'}</h3><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <h4 style="font-size:12.5px;color:var(--ink-500);text-transform:uppercase;margin-bottom:10px;">Basic details</h4>
      <div class="form-grid">
        <div class="form-field"><label>Full name *</label><input id="lf-name" value="${esc(existing?.full_name || '')}" /></div>
        <div class="form-field"><label>Mobile *</label><input id="lf-mobile" value="${esc(existing?.mobile || '')}" ${existing && State.user.role === 'counselor' ? 'readonly title="Only admins can change the mobile number once a lead is created."' : ''} /></div>
        <div class="form-field"><label>WhatsApp number</label><input id="lf-whatsapp" value="${esc(existing?.whatsapp_number || '')}" ${existing && State.user.role === 'counselor' ? 'readonly title="Only admins can change the WhatsApp number once a lead is created."' : ''} /></div>
        <div class="form-field"><label>Email</label><input type="email" id="lf-email" value="${esc(existing?.email || '')}" /></div>
        <div class="form-field"><label>Alternate mobile</label><input id="lf-alt-mobile" value="${esc(existing?.alternate_mobile || '')}" /></div>
        <div class="form-field"><label>City</label><input id="lf-city" value="${esc(existing?.city || '')}" /></div>
        <div class="form-field"><label>State</label><input id="lf-state" value="${esc(existing?.state || '')}" /></div>
        <div class="form-field"><label>Source</label>
          <select id="lf-source"><option value="">—</option>${r.sources.map((s) => `<option value="${s.id}" ${existing?.source_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>Ad name</label><input id="lf-adname" value="${esc(existing?.ad_name || '')}" /></div>
      </div>

      <h4 style="font-size:12.5px;color:var(--ink-500);text-transform:uppercase;margin:18px 0 10px;">Education details</h4>
      <div class="form-grid">
        <div class="form-field"><label>Highest qualification</label><input id="lf-qual" value="${esc(existing?.highest_qualification || '')}" /></div>
        <div class="form-field"><label>Passing year</label><input type="number" id="lf-year" value="${esc(existing?.passing_year || '')}" /></div>
        <div class="form-field"><label>Percentage</label><input type="number" step="0.01" id="lf-percentage" value="${esc(existing?.percentage || '')}" /></div>
        <div class="form-field"><label>Preferred mode</label>
          <select id="lf-mode"><option value="">—</option>${['Online', 'Offline', 'Hybrid'].map((m) => `<option ${existing?.preferred_mode === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>Interested university</label>
          <select id="lf-university"><option value="">—</option>${r.universities.map((u) => `<option value="${u.id}" ${existing?.interested_university_id === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>Interested course</label>
          <select id="lf-course"><option value="">—</option>${r.courses.map((c) => `<option value="${c.id}" ${existing?.interested_course_id === c.id ? 'selected' : ''}>${esc(c.name)} (${esc(c.university_name || '')})</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>Budget (INR)</label><input type="number" id="lf-budget" value="${esc(existing?.budget || '')}" /></div>
      </div>

      <h4 style="font-size:12.5px;color:var(--ink-500);text-transform:uppercase;margin:18px 0 10px;">Lead management</h4>
      <div class="form-grid">
        <div class="form-field"><label>Status</label>
          <select id="lf-status">${r.statuses.map((s) => `<option value="${s.id}" ${existing ? (existing.status_id === s.id ? 'selected' : '') : (s.name === 'New' ? 'selected' : '')}>${esc(s.name)}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>Priority</label>
          <select id="lf-priority">${['Low', 'Medium', 'High'].map((p) => `<option ${((existing?.priority) || 'Medium') === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>Temperature</label>
          <select id="lf-temperature">${['Hot', 'Warm', 'Cold'].map((t) => `<option ${((existing?.temperature) || 'Warm') === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>Assigned counselor</label>
          <select id="lf-counselor" ${State.user.role === 'counselor' ? 'disabled' : ''}>
            <option value="">Unassigned</option>
            ${r.counselors.map((c) => `<option value="${c.id}" ${(existing?.assigned_counselor_id === c.id) || (!existing && State.user.role === 'counselor' && c.id === State.user.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>Next follow-up date</label><input type="date" id="lf-fu-date" value="${existing?.next_followup_date ? existing.next_followup_date.slice(0, 10) : ''}" /></div>
        <div class="form-field"><label>Next follow-up time</label><input type="time" id="lf-fu-time" value="${fmt.time(existing?.next_followup_time)}" /></div>
        <div class="form-field span-2"><label>Remarks</label><textarea id="lf-remarks">${esc(existing?.remarks || '')}</textarea></div>
      </div>
      <p id="lf-error" class="form-error" hidden></p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost modal-close">Cancel</button>
      <button class="btn btn-primary" id="lf-save">${existing ? 'Save changes' : 'Create lead'}</button>
    </div>
  `, { wide: true });

  overlay.querySelector('#lf-save').onclick = async () => saveLeadForm(overlay, existing);

  // India-only auto-fill: WhatsApp number mirrors mobile unless the counselor edits it manually.
  const mobileInput = document.getElementById('lf-mobile');
  const waInput = document.getElementById('lf-whatsapp');
  let waAutoFilled = !existing || !existing.whatsapp_number;
  waInput.addEventListener('input', () => { waAutoFilled = false; });
  mobileInput.addEventListener('input', () => {
    if (!waAutoFilled) return;
    const digits = mobileInput.value.replace(/\D/g, '').slice(-10);
    waInput.value = digits ? `+91${digits}` : '';
  });
}

function collectLeadFormPayload() {
  const val = (id) => { const el = document.getElementById(id); return el.value === '' ? null : el.value; };
  return {
    full_name: val('lf-name'), mobile: val('lf-mobile'), whatsapp_number: val('lf-whatsapp'),
    email: val('lf-email'), alternate_mobile: val('lf-alt-mobile'), city: val('lf-city'), state: val('lf-state'),
    source_id: val('lf-source'), ad_name: val('lf-adname'),
    highest_qualification: val('lf-qual'), passing_year: val('lf-year'), percentage: val('lf-percentage'),
    preferred_mode: val('lf-mode'), interested_university_id: val('lf-university'), interested_course_id: val('lf-course'),
    budget: val('lf-budget'), status_id: val('lf-status'), priority: val('lf-priority'), temperature: val('lf-temperature'),
    assigned_counselor_id: val('lf-counselor'), next_followup_date: val('lf-fu-date'), next_followup_time: val('lf-fu-time'),
    remarks: val('lf-remarks'),
  };
}

async function saveLeadForm(overlay, existing, force = false) {
  const errEl = document.getElementById('lf-error');
  errEl.hidden = true;
  const payload = collectLeadFormPayload();
  if (!payload.full_name || !payload.mobile) { errEl.textContent = 'Full name and mobile are required.'; errEl.hidden = false; return; }
  if (force) payload.force = true;

  try {
    if (existing) {
      await Api.patch(`/leads/${existing.id}`, payload);
      toast('Lead updated.');
    } else {
      const res = await Api.post('/leads', payload);
      if (res && res.warning === 'duplicate_mobile') {
        const proceed = await confirmDialog(`${esc(res.message)} Create anyway?`);
        if (proceed) return saveLeadForm(overlay, existing, true);
        return;
      }
      toast(`Lead ${res.lead_code} created.`);
    }
    overlay.remove();
    if (location.hash.startsWith('#/lead/')) router(); else location.hash = '#/leads';
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
}

const PIPELINE_STAGES = ['New', 'Contacted', 'Interested', 'Follow-up', 'Documents Pending', 'Application Started', 'Application Submitted', 'Payment Pending', 'Enrolled'];

function copyBtn(text, label) {
  if (!text) return '';
  return `<button class="btn-copy" data-copy="${esc(text)}" title="Copy ${label}" style="background:none;border:none;color:var(--indigo-500);cursor:pointer;font-size:12px;margin-left:4px;">⧉</button>`;
}

function renderPipelineStepper(lead) {
  const stageIdx = PIPELINE_STAGES.indexOf(lead.status_name);
  if (stageIdx === -1) {
    return `<div class="pipeline-card" style="margin-bottom:18px;padding:14px 20px;">
      <span style="font-size:13px;color:var(--ink-500);">Current status:</span>
      <span class="badge" style="background:${lead.status_color}22;color:${lead.status_color};margin-left:6px;">${esc(lead.status_name)}</span>
      <span style="font-size:12px;color:var(--ink-500);margin-left:8px;">(not part of the main enrollment pipeline)</span>
    </div>`;
  }
  return `<div class="pipeline-card" style="margin-bottom:18px;padding:16px 20px;">
    <div style="display:flex;align-items:center;overflow-x:auto;gap:2px;">
      ${PIPELINE_STAGES.map((stage, i) => `
        <div style="display:flex;align-items:center;flex-shrink:0;">
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px;min-width:64px;">
            <div style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;
              background:${i < stageIdx ? 'var(--green-500)' : i === stageIdx ? 'var(--indigo-600)' : 'var(--line)'};
              color:${i <= stageIdx ? '#fff' : 'var(--ink-500)'};">${i < stageIdx ? '✓' : i + 1}</div>
            <span style="font-size:10.5px;text-align:center;color:${i === stageIdx ? 'var(--indigo-600)' : 'var(--ink-500)'};font-weight:${i === stageIdx ? 700 : 500};">${esc(stage)}</span>
          </div>
          ${i < PIPELINE_STAGES.length - 1 ? `<div style="width:20px;height:2px;background:${i < stageIdx ? 'var(--green-500)' : 'var(--line)'};margin:0 2px 16px;"></div>` : ''}
        </div>
      `).join('')}
    </div>
  </div>`;
}

function renderTagsCard(lead) {
  return `
    <div class="info-card">
      <h4>Tags</h4>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${lead.tags.map((t) => `
          <span class="badge" style="background:${t.color}22;color:${t.color};">${esc(t.name)}</span>
        `).join('') || '<span style="color:var(--ink-500);font-size:12.5px;">No tags yet.</span>'}
      </div>
    </div>`;
}

// =========================================================
// LEAD PROFILE
// =========================================================
async function renderLeadProfile(content, leadId) {
  const lead = await Api.get(`/leads/${leadId}`);

  content.innerHTML = `
    <a href="#/leads" style="font-size:13px;color:var(--ink-500);display:inline-block;margin-bottom:12px;">← Back to leads</a>

    <div class="profile-header">
      <div class="name-block">
        <h2>${esc(lead.full_name)} ${lead.temperature === 'Hot' ? '<span class="badge priority-High" style="margin-left:8px;">🔥 Hot lead</span>' : ''}</h2>
        <div class="code">${esc(lead.lead_code)} · Created ${fmt.date(lead.created_at)}</div>
        <div class="profile-meta-row">
          <div class="profile-meta-item"><span class="k">Mobile</span><span class="v">${esc(lead.mobile)}${copyBtn(lead.mobile, 'mobile')}</span></div>
          <div class="profile-meta-item"><span class="k">WhatsApp</span><span class="v">${esc(lead.whatsapp_number || '—')}${copyBtn(lead.whatsapp_number, 'WhatsApp number')}</span></div>
          <div class="profile-meta-item"><span class="k">Email</span><span class="v">${esc(lead.email || '—')}${copyBtn(lead.email, 'email')}</span></div>
          <div class="profile-meta-item"><span class="k">Priority</span><span class="v"><span class="badge priority-${lead.priority}">${esc(lead.priority)}</span></span></div>
          <div class="profile-meta-item"><span class="k">Counselor</span><span class="v">${esc(lead.counselor_name || 'Unassigned')}</span></div>
          <div class="profile-meta-item"><span class="k">Last contact</span><span class="v">${leadAgeBadge(lead)}</span></div>
        </div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" onclick="window.location.href='tel:${esc(lead.mobile)}'">📞 Call</button>
        <button class="btn btn-ghost" id="lp-wa-btn">💬 WhatsApp</button>
        <button class="btn btn-secondary" id="lp-edit-btn">Edit lead</button>
        <button class="btn btn-primary" id="lp-status-btn">Change status</button>
        <button class="btn btn-ghost" id="lp-copylink-btn">🔗 Copy link</button>
      </div>
    </div>

    ${renderPipelineStepper(lead)}

    <div class="profile-grid">
      <div>
        ${renderTagsCard(lead)}
        <div class="info-card">
          <h4>Education & interest</h4>
          <div class="info-row"><span class="k">Highest qualification</span><span class="v">${esc(lead.highest_qualification || '—')}</span></div>
          <div class="info-row"><span class="k">Passing year</span><span class="v">${esc(lead.passing_year || '—')}</span></div>
          <div class="info-row"><span class="k">Percentage</span><span class="v">${esc(lead.percentage || '—')}</span></div>
          <div class="info-row"><span class="k">Course</span><span class="v">${esc(lead.course_name || '—')}</span></div>
          <div class="info-row"><span class="k">University</span><span class="v">${esc(lead.university_name || '—')}</span></div>
          <div class="info-row"><span class="k">Preferred mode</span><span class="v">${esc(lead.preferred_mode || '—')}</span></div>
          <div class="info-row"><span class="k">Budget</span><span class="v">${fmt.money(lead.budget)}</span></div>
        </div>
        <div class="info-card">
          <h4>Source</h4>
          <div class="info-row"><span class="k">Source</span><span class="v">${esc(lead.source_name || '—')}</span></div>
          <div class="info-row"><span class="k">Campaign</span><span class="v">${esc(lead.campaign_name || '—')}</span></div>
          <div class="info-row"><span class="k">Ad name</span><span class="v">${esc(lead.ad_name || '—')}</span></div>
          <div class="info-row"><span class="k">City / State</span><span class="v">${esc(lead.city || '—')}, ${esc(lead.state || '—')}</span></div>
        </div>
        <div class="info-card">
          <h4>Remarks</h4>
          <p style="font-size:13px;color:var(--ink-700);line-height:1.5;margin:0;">${esc(lead.remarks || 'No remarks yet.')}</p>
        </div>
      </div>

      <div>
        <div class="tabs" id="lp-tabs">
          <button class="tab-btn active" data-tab="history">History (${lead.notes.length + lead.activities.length})</button>
          <button class="tab-btn" data-tab="followups">Follow-ups (${lead.followups.length})</button>
          <button class="tab-btn" data-tab="apps">Applications & Payments</button>
        </div>
        <div id="lp-tab-content"></div>
      </div>
    </div>
  `;

  document.getElementById('lp-edit-btn').onclick = () => openLeadFormModal(lead);
  document.getElementById('lp-wa-btn').onclick = () => window.open(waLink(lead.whatsapp_number || lead.mobile, lead.full_name, lead.course_name), '_blank');
  document.getElementById('lp-status-btn').onclick = () => openStatusChangeModal(lead);
  document.getElementById('lp-copylink-btn').onclick = () => {
    const link = `${location.origin}${location.pathname}#/lead/${lead.id}`;
    navigator.clipboard?.writeText(link).then(() => toast('Lead link copied — paste it in WhatsApp or Slack.', 'info')).catch(() => {});
  };
  content.querySelectorAll('[data-copy]').forEach((btn) => btn.onclick = () => {
    navigator.clipboard?.writeText(btn.dataset.copy).then(() => toast('Copied.', 'info')).catch(() => {});
  });

  const tabContent = document.getElementById('lp-tab-content');
  async function renderTab(tab) {
    document.querySelectorAll('#lp-tabs .tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'history') {
      // Merge notes + activities into one chronological feed, newest first.
      const noteEntries = lead.notes.map((n) => ({
        kind: 'note', created_at: n.created_at, user: n.created_by_name || 'System',
        line: `${n.note_type}${n.note_type !== 'Note' ? ' — ' : ' — '}${n.content}`,
      }));
      const activityEntries = lead.activities
        .filter((a) => !['note_logged', 'call_logged', 'whatsapp_logged', 'email_logged'].includes(a.action))
        .map((a) => ({ kind: 'activity', created_at: a.created_at, user: a.user_name || 'System', line: describeActivityPlain(a) }));
      const combined = [...noteEntries, ...activityEntries].sort((x, y) => new Date(y.created_at) - new Date(x.created_at));

      tabContent.innerHTML = `
        <div style="display:flex;gap:10px;margin-bottom:14px;">
          <button class="btn btn-secondary btn-small" id="add-note-btn">+ Add note / call log</button>
        </div>
        ${combined.length ? `
          <div class="info-card" style="padding:16px 18px;">
            ${combined.map((e) => `
              <div style="padding:9px 0;border-bottom:1px dashed var(--line);font-size:13px;line-height:1.5;">
                <span style="color:var(--ink-500);font-size:12px;">[${fmt.dateTime(e.created_at)} — ${esc(e.user)}]</span>
                <span style="margin-left:4px;">${e.kind === 'activity' ? `<em style="color:var(--indigo-600);">${e.line}</em>` : esc(e.line)}</span>
              </div>
            `).join('')}
          </div>
        ` : `<div class="empty-state"><h3>No history yet</h3><p>Calls, notes, and status changes will appear here.</p></div>`}
      `;
      document.getElementById('add-note-btn').onclick = () => openNoteModal(lead.id, () => router(), lead.status_id);
    } else if (tab === 'followups') {
      tabContent.innerHTML = `
        <button class="btn btn-secondary btn-small" id="add-followup-btn" style="margin-bottom:12px;">+ Schedule follow-up</button>
        ${lead.followups.length ? lead.followups.map((f) => `
          <div class="followup-item ${f.status === 'Pending' && new Date(f.scheduled_date) < new Date().setHours(0,0,0,0) ? 'overdue' : ''}">
            <div>
              <div class="fu-main">${esc(f.followup_type)} · ${fmt.date(f.scheduled_date)} ${fmt.time(f.scheduled_time)}</div>
              <div class="fu-sub">${esc(f.notes || '')} · by ${esc(f.created_by_name || 'system')} · <strong>${esc(f.status)}</strong></div>
            </div>
            ${f.status === 'Pending' ? `<button class="btn btn-success btn-small" data-complete-fu="${f.id}">Mark done</button>` : ''}
          </div>
        `).join('') : `<div class="empty-state"><h3>No follow-ups yet</h3></div>`}
      `;
      document.getElementById('add-followup-btn').onclick = () => openFollowupModal(lead.id, () => router());
      tabContent.querySelectorAll('[data-complete-fu]').forEach((btn) => btn.onclick = async () => {
        await Api.patch(`/followups/${btn.dataset.completeFu}`, { status: 'Completed' });
        toast('Follow-up completed.');
        router();
      });
    } else if (tab === 'apps') {
      tabContent.innerHTML = `<div class="empty-state">Loading…</div>`;
      const isAdmin = ['super_admin', 'admin'].includes(State.user.role);
      const commissions = isAdmin ? await Api.get(`/commissions/lead/${lead.id}`).catch(() => []) : [];
      tabContent.innerHTML = `
        <div class="info-card" style="margin:0 0 16px;">
          <h4>Applications</h4>
          ${lead.applications.length ? lead.applications.map((a) => `
            <div class="info-row"><span class="k">${esc(a.course_name || '')} — ${esc(a.university_name || '')}</span><span class="v">${esc(a.application_status)}</span></div>
          `).join('') : '<p style="color:var(--ink-500);font-size:13px;">No applications yet.</p>'}
        </div>
        <div class="info-card" style="margin:0 0 16px;">
          <h4>Payments</h4>
          ${lead.payments.length ? lead.payments.map((p) => `
            <div class="info-row"><span class="k">${fmt.date(p.payment_date)} · ${esc(p.payment_method || '')}</span><span class="v">${fmt.money(p.amount)} (${esc(p.payment_status)})</span></div>
          `).join('') : '<p style="color:var(--ink-500);font-size:13px;">No payments recorded yet.</p>'}
        </div>
        ${isAdmin ? `
          <div class="info-card" style="margin:0;">
            <h4>Your commission <button class="btn btn-secondary btn-small" id="add-commission-btn" style="float:right;">+ Add record</button></h4>
            ${commissions.length ? commissions.map((c) => `
              <div class="info-row"><span class="k">${esc(c.university_name || '—')} · enrolled for ${fmt.money(c.enrollment_amount)}</span><span class="v"><strong>${fmt.money(c.commission_amount)}</strong> — ${esc(c.status)}</span></div>
            `).join('') : '<p style="color:var(--ink-500);font-size:13px;">No commission recorded yet for this lead.</p>'}
          </div>
        ` : ''}
      `;
      if (isAdmin) document.getElementById('add-commission-btn').onclick = () => openCommissionModal(lead, () => router());
    }
  }
  document.querySelectorAll('#lp-tabs .tab-btn').forEach((b) => b.onclick = () => renderTab(b.dataset.tab));
  renderTab('history');
}

function describeActivityPlain(a) {
  const map = {
    lead_created: 'Lead was created',
    assigned: 'Lead was assigned to a counselor',
    reassigned: 'Reassigned counselor',
    status_changed: `Status changed from ${a.old_value || '—'} to ${a.new_value || '—'}`,
    priority_changed: `Priority changed from ${a.old_value} to ${a.new_value}`,
    remarks_updated: 'Remarks updated',
    followup_scheduled: `Follow-up scheduled: ${a.new_value || ''}`,
    followup_completed: 'Follow-up marked complete',
  };
  return map[a.action] || (a.action || '').replace(/_/g, ' ');
}

function describeActivity(a) {
  const map = {
    lead_created: 'Lead was created',
    assigned: 'Lead was assigned to a counselor',
    reassigned: `Reassigned counselor`,
    status_changed: `Status changed from <strong>${esc(a.old_value)}</strong> to <strong>${esc(a.new_value)}</strong>`,
    priority_changed: `Priority changed from ${esc(a.old_value)} to ${esc(a.new_value)}`,
    remarks_updated: 'Remarks updated',
    followup_scheduled: `Follow-up scheduled: ${esc(a.new_value)}`,
    followup_completed: 'Follow-up marked complete',
    note_logged: 'Note added',
    call_logged: 'Call logged',
    whatsapp_logged: 'WhatsApp message logged',
    email_logged: 'Email logged',
  };
  return map[a.action] || esc(a.action.replace(/_/g, ' '));
}

function openStatusChangeModal(lead) {
  const overlay = openModal(`
    <div class="modal-header"><h3>Change status</h3><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-field" style="margin-bottom:14px;"><label>New status</label>
        <select id="cs-status">${State.refData.statuses.map((s) => `<option value="${s.id}" ${s.id === lead.status_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      </div>
      <div class="form-field"><label>Comment *</label><textarea id="cs-comment" placeholder="Why is the status changing?"></textarea></div>
      <p id="cs-error" class="form-error" hidden></p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost modal-close">Cancel</button>
      <button class="btn btn-primary" id="cs-save">Update status</button>
    </div>`);
  overlay.querySelector('#cs-save').onclick = async () => {
    const comment = document.getElementById('cs-comment').value.trim();
    const errEl = document.getElementById('cs-error');
    if (!comment) { errEl.textContent = 'Please add a comment explaining this change.'; errEl.hidden = false; return; }
    try {
      const statusName = State.refData.statuses.find((s) => String(s.id) === String(document.getElementById('cs-status').value))?.name;
      await Api.patch(`/leads/${lead.id}`, { status_id: document.getElementById('cs-status').value });
      await Api.post(`/leads/${lead.id}/notes`, { note_type: 'Note', content: `${statusName} - ${comment}` });
      toast('Status updated.');
      overlay.remove();
      router();
    } catch (err) { toast(err.message, 'error'); }
  };
}

function openFollowupModal(leadId, onDone) {
  const overlay = openModal(`
    <div class="modal-header"><h3>Schedule follow-up</h3><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="form-field"><label>Date *</label><input type="date" id="fu-date" /></div>
        <div class="form-field"><label>Time</label><input type="time" id="fu-time" /></div>
        <div class="form-field"><label>Type</label>
          <select id="fu-type">${['Call', 'WhatsApp', 'Email', 'Meeting', 'Other'].map((t) => `<option>${t}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>Reminder (minutes before)</label><input type="number" id="fu-reminder" value="30" /></div>
        <div class="form-field span-2"><label>Notes</label><textarea id="fu-notes"></textarea></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost modal-close">Cancel</button>
      <button class="btn btn-primary" id="fu-save">Schedule</button>
    </div>`);
  overlay.querySelector('#fu-save').onclick = async () => {
    const date = document.getElementById('fu-date').value;
    if (!date) { toast('Please pick a date.', 'error'); return; }
    try {
      await Api.post(`/followups/lead/${leadId}`, {
        scheduled_date: date, scheduled_time: document.getElementById('fu-time').value || null,
        followup_type: document.getElementById('fu-type').value,
        reminder_minutes_before: document.getElementById('fu-reminder').value,
        notes: document.getElementById('fu-notes').value || null,
      });
      toast('Follow-up scheduled.');
      overlay.remove();
      onDone();
    } catch (err) { toast(err.message, 'error'); }
  };
}

function openNoteModal(leadId, onDone, currentStatusId = null) {
  const overlay = openModal(`
    <div class="modal-header"><h3>Add note / call log</h3><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="form-field"><label>Type</label>
          <select id="note-type">${['Call', 'WhatsApp', 'Email', 'Note'].map((t) => `<option>${t}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>Change lead status (optional)</label>
          <select id="note-status">
            <option value="">Keep current status</option>
            ${State.refData.statuses.map((s) => `<option value="${s.id}" ${currentStatusId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field span-2"><label>Details *</label><textarea id="note-content" placeholder="What happened?"></textarea></div>
      </div>
      <p style="font-size:12px;color:var(--ink-500);margin-top:2px;">Tip: add or rename call outcomes anytime in Settings → Lead Statuses.</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost modal-close">Cancel</button>
      <button class="btn btn-primary" id="note-save">Save</button>
    </div>`);
  overlay.querySelector('#note-save').onclick = async () => {
    const content = document.getElementById('note-content').value.trim();
    const statusId = document.getElementById('note-status').value;
    if (!content) { toast('Please add some details.', 'error'); return; }
    try {
      const statusName = statusId ? State.refData.statuses.find((s) => String(s.id) === String(statusId))?.name : null;
      const finalContent = statusName ? `${statusName} - ${content}` : content;
      await Api.post(`/leads/${leadId}/notes`, { note_type: document.getElementById('note-type').value, content: finalContent });
      if (statusId) {
        await Api.patch(`/leads/${leadId}`, { status_id: statusId });
      }
      toast(statusId ? 'Saved and status updated.' : 'Saved.');
      overlay.remove();
      onDone();
    } catch (err) { toast(err.message, 'error'); }
  };
}

// =========================================================
// COMMISSION MODAL
// =========================================================
function openCommissionModal(lead, onDone) {
  const uni = State.refData.universities.find((u) => u.id === lead.interested_university_id);
  const rateLabel = uni ? (uni.commission_type === 'fixed' ? `₹${uni.commission_value} fixed` : `${uni.commission_value}% of enrollment amount`) : 'No rate set for this university yet';

  const overlay = openModal(`
    <div class="modal-header"><h3>Add commission record</h3><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <p style="font-size:12.5px;color:var(--ink-500);margin-bottom:14px;">University rate: <strong>${esc(rateLabel)}</strong> ${!uni ? '— set this in Settings → Universities for auto-calculation.' : ''}</p>
      <div class="form-grid">
        <div class="form-field"><label>Enrollment / tuition amount (₹) *</label><input type="number" id="cm-enrollment" /></div>
        <div class="form-field"><label>Commission amount (₹) *</label><input type="number" id="cm-commission" /></div>
        <div class="form-field"><label>Expected payout date</label><input type="date" id="cm-expected" /></div>
        <div class="form-field span-2"><label>Notes</label><textarea id="cm-notes"></textarea></div>
      </div>
      <p id="cm-error" class="form-error" hidden></p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost modal-close">Cancel</button>
      <button class="btn btn-primary" id="cm-save">Save</button>
    </div>
  `);

  const enrollmentInput = overlay.querySelector('#cm-enrollment');
  const commissionInput = overlay.querySelector('#cm-commission');
  enrollmentInput.addEventListener('input', () => {
    if (!uni || !uni.commission_value) return;
    const amt = Number(enrollmentInput.value) || 0;
    commissionInput.value = uni.commission_type === 'fixed' ? uni.commission_value : ((amt * uni.commission_value) / 100).toFixed(2);
  });

  overlay.querySelector('#cm-save').onclick = async () => {
    const errEl = document.getElementById('cm-error');
    const enrollment_amount = enrollmentInput.value;
    const commission_amount = commissionInput.value;
    if (!enrollment_amount || !commission_amount) { errEl.textContent = 'Enrollment amount and commission amount are required.'; errEl.hidden = false; return; }
    try {
      await Api.post('/commissions', {
        lead_id: lead.id, university_id: lead.interested_university_id, course_id: lead.interested_course_id,
        enrollment_amount, commission_amount,
        expected_date: document.getElementById('cm-expected').value || null,
        notes: document.getElementById('cm-notes').value || null,
      });
      toast('Commission record added.');
      overlay.remove();
      onDone();
    } catch (err) { errEl.textContent = err.message; errEl.hidden = false; }
  };
}

// =========================================================
// CSV IMPORT WIZARD
// =========================================================
function openCsvImportWizard() {
  const overlay = openModal(`
    <div class="modal-header"><h3>Import leads from CSV</h3><button class="modal-close">✕</button></div>
    <div class="modal-body" id="csv-wizard-body">
      <p style="font-size:13px;color:var(--ink-500);margin-bottom:14px;">
        Expected columns: Name, Mobile, WhatsApp, Email, City, State, Source, Campaign, Ad Name, Course, University, Status, Priority, Assigned Counselor, Follow-up Date, Follow-up Time, Remarks.
      </p>
      <div class="dropzone" id="csv-dropzone">
        <input type="file" id="csv-file-input" accept=".csv" style="display:none;" />
        <div>📄 Click to choose a CSV file</div>
      </div>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost modal-close">Cancel</button></div>
  `, { wide: true });

  const dropzone = overlay.querySelector('#csv-dropzone');
  const fileInput = overlay.querySelector('#csv-file-input');
  dropzone.onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const body = overlay.querySelector('#csv-wizard-body');
    body.innerHTML = `<div class="empty-state">Validating file…</div>`;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const preview = await Api.postForm('/csv/preview', formData);
      renderCsvPreview(overlay, preview, file.name);
    } catch (err) {
      body.innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
    }
  };
}

function renderCsvPreview(overlay, preview, fileName) {
  const body = overlay.querySelector('#csv-wizard-body');
  const footer = overlay.querySelector('.modal-footer');
  body.innerHTML = `
    <div class="import-summary">
      <div class="pill" style="background:var(--indigo-100);color:var(--indigo-600)">${preview.totalRows} total rows</div>
      <div class="pill" style="background:var(--green-100);color:var(--green-500)">${preview.validRows} ready to import</div>
      <div class="pill" style="background:var(--coral-100);color:var(--coral-500)">${preview.invalidRows} need attention</div>
    </div>
    <div class="table-wrap" style="max-height:340px;">
      <table class="data-table">
        <thead><tr><th>#</th><th>Name</th><th>Mobile</th><th>Status</th></tr></thead>
        <tbody>
          ${preview.preview.slice(0, 200).map((p) => `
            <tr>
              <td>${p.row}</td>
              <td>${esc(p.data.Name || '')}</td>
              <td>${esc(p.data.Mobile || '')}</td>
              <td>${p.errors.length ? `<span style="color:var(--coral-500);font-size:12px;">${p.errors.map(esc).join('; ')}</span>` : '<span style="color:var(--green-500);">✓ Valid</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  footer.innerHTML = `
    <button class="btn btn-ghost modal-close">Cancel</button>
    <button class="btn btn-primary" id="csv-confirm-import">Import ${preview.validRows} valid rows</button>
  `;
  footer.querySelectorAll('.modal-close').forEach((b) => b.onclick = () => overlay.remove());
  footer.querySelector('#csv-confirm-import').onclick = async () => {
    const rows = preview.preview.filter((p) => p.valid).map((p) => p.data);
    if (!rows.length) { toast('No valid rows to import.', 'error'); return; }
    try {
      const res = await Api.post('/csv/import', { rows, fileName });
      toast(`Imported ${res.imported} leads${res.failed ? `, ${res.failed} failed` : ''}.`);
      overlay.remove();
      router();
    } catch (err) { toast(err.message, 'error'); }
  };
}
