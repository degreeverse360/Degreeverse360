const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { logActivity, notifyUser } = require('../utils/logging');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

function visibilityClause(req, alias = 'l') {
  return req.user.role === 'counselor' ? `AND ${alias}.assigned_counselor_id = ${req.user.id}` : '';
}

// ---------- GET /api/followups?range=today|upcoming|overdue ----------
router.get('/', async (req, res, next) => {
  try {
    const { range = 'today' } = req.query;
    let dateFilter = '';
    if (range === 'today') dateFilter = "f.scheduled_date = CURRENT_DATE AND f.status = 'Pending'";
    else if (range === 'upcoming') dateFilter = "f.scheduled_date > CURRENT_DATE AND f.status = 'Pending'";
    else if (range === 'overdue') dateFilter = "f.scheduled_date < CURRENT_DATE AND f.status = 'Pending'";
    else dateFilter = '1=1';

    const { rows } = await pool.query(`
      SELECT f.*, l.full_name, l.mobile, l.lead_code, l.assigned_counselor_id, u.name AS counselor_name
      FROM followups f
      JOIN leads l ON l.id = f.lead_id
      LEFT JOIN users u ON u.id = l.assigned_counselor_id
      WHERE ${dateFilter} ${visibilityClause(req)}
      ORDER BY f.scheduled_date ASC, f.scheduled_time ASC NULLS LAST
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------- POST /api/leads/:leadId/followups  (mounted separately below) ----------
router.post('/lead/:leadId', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { leadId } = req.params;
    const { scheduled_date, scheduled_time, followup_type = 'Call', notes, reminder_minutes_before = 30 } = req.body;
    if (!scheduled_date) throw new AppError('Follow-up date is required.');

    const { rows } = await client.query(
      `INSERT INTO followups (lead_id, scheduled_date, scheduled_time, followup_type, notes, reminder_minutes_before, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [leadId, scheduled_date, scheduled_time || null, followup_type, notes || null, reminder_minutes_before, req.user.id]
    );
    await client.query('UPDATE leads SET next_followup_date = $1, next_followup_time = $2 WHERE id = $3', [scheduled_date, scheduled_time || null, leadId]);
    await logActivity(client, { leadId, userId: req.user.id, action: 'followup_scheduled', newValue: `${scheduled_date} ${scheduled_time || ''} (${followup_type})` });

    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ---------- PATCH /api/followups/:id  (mark complete / missed / reschedule) ----------
router.patch('/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { status, scheduled_date, scheduled_time, notes } = req.body;

    const fields = [];
    const values = [];
    let i = 1;
    if (status !== undefined) { fields.push(`status = $${i++}`); values.push(status); }
    if (scheduled_date !== undefined) { fields.push(`scheduled_date = $${i++}`); values.push(scheduled_date); }
    if (scheduled_time !== undefined) { fields.push(`scheduled_time = $${i++}`); values.push(scheduled_time); }
    if (notes !== undefined) { fields.push(`notes = $${i++}`); values.push(notes); }
    if (status === 'Completed') fields.push(`completed_at = now()`);
    if (!fields.length) throw new AppError('No fields to update.');

    values.push(id);
    const { rows } = await client.query(`UPDATE followups SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    if (!rows[0]) throw new AppError('Follow-up not found.', 404);

    await logActivity(client, { leadId: rows[0].lead_id, userId: req.user.id, action: `followup_${(status || 'updated').toLowerCase()}` });

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
