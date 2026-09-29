const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit } = require('../utils/logging');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

const ASSIGNABLE_COLORS = ['#2A3EB1', '#00B8A9', '#7C5CFC', '#F5A623', '#E14B4B', '#1FAE6B'];

// ---------- GET /api/users  (list, super_admin + admin) ----------
router.get('/', requireRole('super_admin', 'admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.email, u.mobile, u.is_active, u.avatar_color, r.name AS role,
        (SELECT COUNT(*) FROM leads l WHERE l.assigned_counselor_id = u.id) AS assigned_leads,
        (SELECT COUNT(*) FROM leads l JOIN lead_statuses s ON s.id = l.status_id
          WHERE l.assigned_counselor_id = u.id AND s.is_won) AS converted_leads,
        (SELECT COUNT(*) FROM leads l JOIN lead_statuses s ON s.id = l.status_id
          WHERE l.assigned_counselor_id = u.id AND s.is_lost) AS lost_leads,
        (SELECT COUNT(*) FROM followups f JOIN leads l ON l.id = f.lead_id
          WHERE l.assigned_counselor_id = u.id AND f.status = 'Completed') AS followups_completed
      FROM users u JOIN roles r ON r.id = u.role_id
      ORDER BY u.created_at DESC
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------- GET /api/users/counselors  (light list, any authenticated user — for assignment dropdowns) ----------
router.get('/counselors', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.avatar_color FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE r.name IN ('counselor', 'admin', 'super_admin') AND u.is_active = TRUE
      ORDER BY u.name
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------- POST /api/users  (create, super_admin only) ----------
router.post('/', requireRole('super_admin'), async (req, res, next) => {
  try {
    const { name, email, mobile, password, role } = req.body;
    if (!name || !email || !password || !role) throw new AppError('Name, email, password and role are required.');
    if (!['super_admin', 'admin', 'counselor'].includes(role)) throw new AppError('Invalid role.');
    if (password.length < 8) throw new AppError('Password must be at least 8 characters.');

    const { rows: roleRows } = await pool.query('SELECT id FROM roles WHERE name = $1', [role]);
    const hash = await bcrypt.hash(password, 10);
    const color = ASSIGNABLE_COLORS[Math.floor(Math.random() * ASSIGNABLE_COLORS.length)];

    const { rows } = await pool.query(
      `INSERT INTO users (name, email, mobile, password_hash, role_id, avatar_color)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, mobile, is_active, avatar_color`,
      [name, email.toLowerCase().trim(), mobile || null, hash, roleRows[0].id, color]
    );

    await logAudit({ userId: req.user.id, entityType: 'user', entityId: rows[0].id, action: 'create', details: { role } });
    res.status(201).json({ ...rows[0], role });
  } catch (err) { next(err); }
});

// ---------- PATCH /api/users/:id  (update, super_admin only) ----------
router.patch('/:id', requireRole('super_admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, mobile, role, is_active, password } = req.body;

    const fields = [];
    const values = [];
    let i = 1;

    if (name !== undefined) { fields.push(`name = $${i++}`); values.push(name); }
    if (mobile !== undefined) { fields.push(`mobile = $${i++}`); values.push(mobile); }
    if (is_active !== undefined) { fields.push(`is_active = $${i++}`); values.push(is_active); }
    if (role !== undefined) {
      const { rows: roleRows } = await pool.query('SELECT id FROM roles WHERE name = $1', [role]);
      if (!roleRows[0]) throw new AppError('Invalid role.');
      fields.push(`role_id = $${i++}`); values.push(roleRows[0].id);
    }
    if (password) {
      if (password.length < 8) throw new AppError('Password must be at least 8 characters.');
      const hash = await bcrypt.hash(password, 10);
      fields.push(`password_hash = $${i++}`); values.push(hash);
    }
    if (!fields.length) throw new AppError('No fields to update.');

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, name, email, mobile, is_active`,
      values
    );
    if (!rows[0]) throw new AppError('User not found.', 404);

    await logAudit({ userId: req.user.id, entityType: 'user', entityId: id, action: 'update' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
