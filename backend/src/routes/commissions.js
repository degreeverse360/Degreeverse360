const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity } = require('../utils/logging');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth, requireRole('super_admin', 'admin'));

const LIST_SELECT = `
  SELECT c.*, l.full_name AS lead_name, l.lead_code, u.name AS university_name, co.name AS course_name,
    creator.name AS created_by_name
  FROM commissions c
  JOIN leads l ON l.id = c.lead_id
  LEFT JOIN universities u ON u.id = c.university_id
  LEFT JOIN courses co ON co.id = c.course_id
  LEFT JOIN users creator ON creator.id = c.created_by
`;

// ---------- GET /api/commissions?status=&universityId=&dateFrom=&dateTo= ----------
router.get('/', async (req, res, next) => {
  try {
    const where = [];
    const values = [];
    if (req.query.status) { values.push(req.query.status); where.push(`c.status = $${values.length}`); }
    if (req.query.universityId) { values.push(req.query.universityId); where.push(`c.university_id = $${values.length}`); }
    if (req.query.dateFrom) { values.push(req.query.dateFrom); where.push(`c.created_at::date >= $${values.length}`); }
    if (req.query.dateTo) { values.push(req.query.dateTo); where.push(`c.created_at::date <= $${values.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await pool.query(`${LIST_SELECT} ${whereSql} ORDER BY c.created_at DESC`, values);
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------- GET /api/commissions/summary ----------
router.get('/summary', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COALESCE(SUM(commission_amount) FILTER (WHERE status = 'Pending'), 0) AS pending_total,
        COALESCE(SUM(commission_amount) FILTER (WHERE status = 'Invoiced'), 0) AS invoiced_total,
        COALESCE(SUM(commission_amount) FILTER (WHERE status = 'Received'), 0) AS received_total,
        COUNT(*) FILTER (WHERE status = 'Pending') AS pending_count,
        COUNT(*) FILTER (WHERE status = 'Invoiced') AS invoiced_count,
        COUNT(*) FILTER (WHERE status = 'Received') AS received_count
      FROM commissions
    `);
    const { rows: byUni } = await pool.query(`
      SELECT u.name AS university, COUNT(c.id) AS enrollments,
        COALESCE(SUM(c.commission_amount), 0) AS total_commission,
        COALESCE(SUM(c.commission_amount) FILTER (WHERE c.status = 'Received'), 0) AS received
      FROM commissions c LEFT JOIN universities u ON u.id = c.university_id
      GROUP BY u.name ORDER BY total_commission DESC
    `);
    res.json({ ...rows[0], byUniversity: byUni });
  } catch (err) { next(err); }
});

// ---------- GET /api/commissions/lead/:leadId ----------
router.get('/lead/:leadId', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`${LIST_SELECT} WHERE c.lead_id = $1 ORDER BY c.created_at DESC`, [req.params.leadId]);
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------- POST /api/commissions  (create a record for a lead, usually on enrollment) ----------
router.post('/', async (req, res, next) => {
  try {
    const { lead_id, university_id, course_id, enrollment_amount, commission_amount, expected_date, notes } = req.body;
    if (!lead_id || !enrollment_amount || commission_amount === undefined) {
      throw new AppError('Lead, enrollment amount, and commission amount are required.');
    }
    const { rows } = await pool.query(
      `INSERT INTO commissions (lead_id, university_id, course_id, enrollment_amount, commission_amount, expected_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [lead_id, university_id || null, course_id || null, enrollment_amount, commission_amount, expected_date || null, notes || null, req.user.id]
    );
    await logActivity(pool, { leadId: lead_id, userId: req.user.id, action: 'remarks_updated', notes: `Commission record added: ${commission_amount}` }).catch(() => {});
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ---------- PATCH /api/commissions/:id  (update status, amounts, dates) ----------
router.patch('/:id', async (req, res, next) => {
  try {
    const editable = ['enrollment_amount', 'commission_amount', 'status', 'expected_date', 'received_date', 'notes'];
    const fields = [];
    const values = [];
    let i = 1;
    for (const key of editable) {
      if (req.body[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(req.body[key]); }
    }
    if (!fields.length) throw new AppError('No fields to update.');
    if (req.body.status === 'Received' && req.body.received_date === undefined) {
      fields.push(`received_date = $${i++}`); values.push(new Date().toISOString().slice(0, 10));
    }
    values.push(req.params.id);
    const { rows } = await pool.query(`UPDATE commissions SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    if (!rows[0]) throw new AppError('Commission record not found.', 404);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ---------- DELETE /api/commissions/:id ----------
router.delete('/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM commissions WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted.' });
  } catch (err) { next(err); }
});

module.exports = router;
