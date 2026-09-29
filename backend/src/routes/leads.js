const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity, notifyUser, logAudit } = require('../utils/logging');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

/**
 * Role-based visibility rule (core requirement):
 *  - super_admin & admin -> see ALL leads
 *  - counselor -> sees ONLY leads assigned to them
 */
function applyVisibility(req, whereClauses, values) {
  if (req.user.role === 'counselor') {
    values.push(req.user.id);
    whereClauses.push(`l.assigned_counselor_id = $${values.length}`);
  }
}

async function nextLeadCode(client) {
  const { rows } = await client.query("SELECT nextval('lead_code_seq') AS n");
  return `DGV-${String(rows[0].n).padStart(6, '0')}`;
}

const LEAD_SELECT = `
  SELECT l.*, 
    ls.name AS status_name, ls.color AS status_color, ls.is_won, ls.is_lost,
    src.name AS source_name, camp.name AS campaign_name,
    u.name AS counselor_name, u.avatar_color AS counselor_color,
    c.name AS course_name, uni.name AS university_name,
    owner.name AS owner_name
  FROM leads l
  LEFT JOIN lead_statuses ls ON ls.id = l.status_id
  LEFT JOIN lead_sources src ON src.id = l.source_id
  LEFT JOIN campaigns camp ON camp.id = l.campaign_id
  LEFT JOIN users u ON u.id = l.assigned_counselor_id
  LEFT JOIN users owner ON owner.id = l.lead_owner_id
  LEFT JOIN courses c ON c.id = l.interested_course_id
  LEFT JOIN universities uni ON uni.id = l.interested_university_id
`;

// ---------- GET /api/leads  (list with filters, search, pagination) ----------
router.get('/', async (req, res, next) => {
  try {
    const {
      search, status, counselor, source, course, university, priority, temperature,
      dateFrom, dateTo, followupFrom, followupTo, page = 1, pageSize = 25,
      sortBy = 'created_at', sortDir = 'desc',
    } = req.query;

    const where = [];
    const values = [];
    applyVisibility(req, where, values);

    if (search) {
      values.push(`%${search}%`);
      const idx = values.length;
      where.push(`(l.full_name ILIKE $${idx} OR l.mobile ILIKE $${idx} OR l.email ILIKE $${idx} OR l.lead_code ILIKE $${idx})`);
    }
    if (status) { values.push(status.split(',')); where.push(`ls.name = ANY($${values.length})`); }
    if (counselor) { values.push(counselor); where.push(`l.assigned_counselor_id = $${values.length}`); }
    if (source) { values.push(source.split(',')); where.push(`src.name = ANY($${values.length})`); }
    if (course) { values.push(course); where.push(`l.interested_course_id = $${values.length}`); }
    if (university) { values.push(university); where.push(`l.interested_university_id = $${values.length}`); }
    if (priority) { values.push(priority.split(',')); where.push(`l.priority = ANY($${values.length})`); }
    if (temperature) { values.push(temperature.split(',')); where.push(`l.temperature = ANY($${values.length})`); }
    if (dateFrom) { values.push(dateFrom); where.push(`l.created_at >= $${values.length}`); }
    if (dateTo) { values.push(dateTo); where.push(`l.created_at <= $${values.length}::date + INTERVAL '1 day'`); }
    if (followupFrom) { values.push(followupFrom); where.push(`l.next_followup_date >= $${values.length}`); }
    if (followupTo) { values.push(followupTo); where.push(`l.next_followup_date <= $${values.length}`); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const allowedSort = ['created_at', 'full_name', 'next_followup_date', 'lead_date', 'updated_at'];
    const sortCol = allowedSort.includes(sortBy) ? `l.${sortBy}` : 'l.created_at';
    const dir = sortDir.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const limit = Math.min(parseInt(pageSize, 10) || 25, 200);
    const offset = (Math.max(parseInt(page, 10), 1) - 1) * limit;

    const countQuery = `SELECT COUNT(*) FROM leads l
      LEFT JOIN lead_statuses ls ON ls.id = l.status_id
      LEFT JOIN lead_sources src ON src.id = l.source_id
      ${whereSql}`;
    const { rows: countRows } = await pool.query(countQuery, values);

    values.push(limit, offset);
    const listQuery = `${LEAD_SELECT} ${whereSql} ORDER BY ${sortCol} ${dir} LIMIT $${values.length - 1} OFFSET $${values.length}`;
    const { rows } = await pool.query(listQuery, values);

    res.json({
      data: rows,
      pagination: { page: Number(page), pageSize: limit, total: Number(countRows[0].count) },
    });
  } catch (err) { next(err); }
});

// ---------- GET /api/leads/:id  (full profile) ----------
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const where = ['l.id = $1'];
    const values = [id];
    applyVisibility(req, where, values);

    const { rows } = await pool.query(`${LEAD_SELECT} WHERE ${where.join(' AND ')}`, values);
    if (!rows[0]) throw new AppError('Lead not found or you do not have access to it.', 404);
    const lead = rows[0];

    const [followups, notes, activities, documents, applications, payments, tags] = await Promise.all([
      pool.query(`SELECT f.*, u.name AS created_by_name FROM followups f LEFT JOIN users u ON u.id = f.created_by
                  WHERE f.lead_id = $1 ORDER BY f.scheduled_date DESC, f.scheduled_time DESC`, [id]),
      pool.query(`SELECT n.*, u.name AS created_by_name FROM notes n LEFT JOIN users u ON u.id = n.created_by
                  WHERE n.lead_id = $1 ORDER BY n.created_at DESC`, [id]),
      pool.query(`SELECT a.*, u.name AS user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id
                  WHERE a.lead_id = $1 ORDER BY a.created_at DESC LIMIT 200`, [id]),
      pool.query(`SELECT * FROM documents WHERE lead_id = $1 ORDER BY uploaded_at DESC`, [id]),
      pool.query(`SELECT ap.*, c.name AS course_name, uni.name AS university_name FROM applications ap
                  LEFT JOIN courses c ON c.id = ap.course_id LEFT JOIN universities uni ON uni.id = ap.university_id
                  WHERE ap.lead_id = $1 ORDER BY ap.created_at DESC`, [id]),
      pool.query(`SELECT * FROM payments WHERE lead_id = $1 ORDER BY created_at DESC`, [id]),
      pool.query(`SELECT t.id, t.name, t.color FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.lead_id = $1`, [id]),
    ]);

    res.json({
      ...lead,
      followups: followups.rows,
      notes: notes.rows,
      activities: activities.rows,
      documents: documents.rows,
      applications: applications.rows,
      payments: payments.rows,
      tags: tags.rows,
    });
  } catch (err) { next(err); }
});

// ---------- POST /api/leads  (create) ----------
router.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const b = req.body;
    if (!b.full_name || !b.mobile) throw new AppError('Full name and mobile number are required.');

    // Duplicate protection — warn but allow override via force=true
    const { rows: dupes } = await client.query('SELECT id, lead_code, full_name FROM leads WHERE mobile = $1', [b.mobile]);
    if (dupes.length && !b.force) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        warning: 'duplicate_mobile',
        message: `A lead with this mobile number already exists (${dupes[0].lead_code} — ${dupes[0].full_name}).`,
        existing: dupes[0],
      });
    }

    const { rows: defaultStatus } = await client.query("SELECT id FROM lead_statuses WHERE name = 'New'");
    const leadCode = await nextLeadCode(client);

    const counselorId = b.assigned_counselor_id || (req.user.role === 'counselor' ? req.user.id : null);

    const { rows } = await client.query(
      `INSERT INTO leads (
        lead_code, full_name, mobile, whatsapp_number, email, alternate_mobile, city, state,
        source_id, campaign_id, ad_name, lead_date,
        highest_qualification, passing_year, percentage, interested_course_id, interested_university_id,
        preferred_mode, budget,
        status_id, priority, temperature, next_followup_date, next_followup_time, remarks,
        assigned_counselor_id, lead_owner_id, created_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8, $9,$10,$11,COALESCE($12, now()), $13,$14,$15,$16,$17, $18,$19,
        COALESCE($20::integer, $21::integer), COALESCE($22,'Medium'), COALESCE($23,'Warm'), $24, $25, $26, $27, $28, $29
      ) RETURNING id, lead_code`,
      [
        leadCode, b.full_name, b.mobile, b.whatsapp_number || null, b.email || null, b.alternate_mobile || null,
        b.city || null, b.state || null,
        b.source_id || null, b.campaign_id || null, b.ad_name || null, b.lead_date || null,
        b.highest_qualification || null, b.passing_year || null, b.percentage || null,
        b.interested_course_id || null, b.interested_university_id || null,
        b.preferred_mode || null, b.budget || null,
        b.status_id || null, defaultStatus[0].id, b.priority, b.temperature,
        b.next_followup_date || null, b.next_followup_time || null, b.remarks || null,
        counselorId, req.user.id, req.user.id,
      ]
    );

    const leadId = rows[0].id;
    await logActivity(client, { leadId, userId: req.user.id, action: 'lead_created', notes: `Created via ${b.source_id ? 'form' : 'manual entry'}` });

    if (counselorId) {
      await logActivity(client, { leadId, userId: req.user.id, action: 'assigned', newValue: String(counselorId) });
      await notifyUser(client, { userId: counselorId, leadId, type: 'lead_assigned', message: `New lead assigned: ${b.full_name}` });
    }
    if (Array.isArray(b.tag_ids)) {
      for (const tagId of b.tag_ids) {
        await client.query('INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [leadId, tagId]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ id: leadId, lead_code: rows[0].lead_code });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ---------- PATCH /api/leads/:id  (update — handles status change / reassignment with full audit trail) ----------
router.patch('/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const b = req.body;

    const visWhere = ['id = $1'];
    const visValues = [id];
    if (req.user.role === 'counselor') { visValues.push(req.user.id); visWhere.push(`assigned_counselor_id = $${visValues.length}`); }
    const { rows: currentRows } = await client.query(`SELECT * FROM leads WHERE ${visWhere.join(' AND ')}`, visValues);
    const current = currentRows[0];
    if (!current) throw new AppError('Lead not found or you do not have access to it.', 404);

    // Counselors cannot reassign leads to someone else
    if (req.user.role === 'counselor' && b.assigned_counselor_id && Number(b.assigned_counselor_id) !== req.user.id) {
      throw new AppError('Only admins can reassign leads to another counselor.', 403);
    }

    const editable = [
      'full_name', 'mobile', 'whatsapp_number', 'email', 'alternate_mobile', 'city', 'state',
      'source_id', 'campaign_id', 'ad_name',
      'highest_qualification', 'passing_year', 'percentage', 'interested_course_id', 'interested_university_id',
      'preferred_mode', 'budget',
      'status_id', 'priority', 'temperature', 'next_followup_date', 'next_followup_time',
      'last_contacted_date', 'remarks', 'assigned_counselor_id',
    ];

    const fields = [];
    const values = [];
    let i = 1;
    for (const key of editable) {
      if (b[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(b[key]); }
    }
    if (!fields.length) throw new AppError('No fields to update.');

    values.push(id);
    const { rows: updatedRows } = await client.query(
      `UPDATE leads SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    const updated = updatedRows[0];

    // Log meaningful field-level changes to the activity timeline
    if (b.status_id !== undefined && String(b.status_id) !== String(current.status_id)) {
      const { rows: statusNames } = await client.query(
        `SELECT id, name FROM lead_statuses WHERE id IN ($1, $2)`, [current.status_id, b.status_id]
      );
      const oldName = statusNames.find(s => s.id === current.status_id)?.name;
      const newName = statusNames.find(s => s.id === Number(b.status_id))?.name;
      await logActivity(client, { leadId: id, userId: req.user.id, action: 'status_changed', fieldName: 'status', oldValue: oldName, newValue: newName });
    }
    if (b.assigned_counselor_id !== undefined && String(b.assigned_counselor_id) !== String(current.assigned_counselor_id)) {
      await logActivity(client, { leadId: id, userId: req.user.id, action: 'reassigned', fieldName: 'assigned_counselor_id', oldValue: String(current.assigned_counselor_id), newValue: String(b.assigned_counselor_id) });
      if (b.assigned_counselor_id) {
        await notifyUser(client, { userId: b.assigned_counselor_id, leadId: id, type: 'lead_assigned', message: `Lead assigned to you: ${updated.full_name}` });
      }
    }
    if (b.priority !== undefined && b.priority !== current.priority) {
      await logActivity(client, { leadId: id, userId: req.user.id, action: 'priority_changed', oldValue: current.priority, newValue: b.priority });
    }
    if (b.remarks !== undefined && b.remarks !== current.remarks) {
      await logActivity(client, { leadId: id, userId: req.user.id, action: 'remarks_updated' });
    }

    await client.query('COMMIT');
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ---------- DELETE /api/leads/:id  (admin & super_admin only) ----------
router.delete('/:id', requireRole('super_admin', 'admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query('DELETE FROM leads WHERE id = $1 RETURNING id, full_name', [id]);
    if (!rows[0]) throw new AppError('Lead not found.', 404);
    await logAudit({ userId: req.user.id, entityType: 'lead', entityId: id, action: 'delete', details: { name: rows[0].full_name } });
    res.json({ message: 'Lead deleted.' });
  } catch (err) { next(err); }
});

// ---------- POST /api/leads/:id/notes ----------
router.post('/:id/notes', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { note_type = 'Note', content } = req.body;
    if (!content) throw new AppError('Note content is required.');

    const { rows } = await client.query(
      `INSERT INTO notes (lead_id, note_type, content, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, note_type, content, req.user.id]
    );
    await client.query('UPDATE leads SET last_contacted_date = now() WHERE id = $1', [id]);
    await logActivity(client, { leadId: id, userId: req.user.id, action: `${note_type.toLowerCase()}_logged`, notes: content.slice(0, 140) });

    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ---------- POST /api/leads/:id/tags  { tag_id } ----------
router.post('/:id/tags', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tag_id } = req.body;
    if (!tag_id) throw new AppError('tag_id is required.');
    await pool.query('INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, tag_id]);
    res.status(201).json({ message: 'Tag added.' });
  } catch (err) { next(err); }
});

// ---------- DELETE /api/leads/:id/tags/:tagId ----------
router.delete('/:id/tags/:tagId', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM lead_tags WHERE lead_id = $1 AND tag_id = $2', [req.params.id, req.params.tagId]);
    res.json({ message: 'Tag removed.' });
  } catch (err) { next(err); }
});

module.exports = router;
