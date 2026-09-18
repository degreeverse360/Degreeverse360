const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

/**
 * Generic factory for simple reference-data CRUD (sources, campaigns, tags, statuses).
 * Reads are open to all authenticated users; writes are super_admin only.
 */
function simpleResource(table, fields, opts = {}) {
  const r = express.Router();

  r.get('/', async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY ${opts.orderBy || 'id'}`);
      res.json(rows);
    } catch (err) { next(err); }
  });

  r.post('/', requireRole('super_admin', 'admin'), async (req, res, next) => {
    try {
      const cols = fields.filter((f) => req.body[f] !== undefined);
      if (!cols.length) throw new AppError('No fields provided.');
      const values = cols.map((f) => req.body[f]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await pool.query(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        values
      );
      res.status(201).json(rows[0]);
    } catch (err) { next(err); }
  });

  r.patch('/:id', requireRole('super_admin', 'admin'), async (req, res, next) => {
    try {
      const cols = fields.filter((f) => req.body[f] !== undefined);
      if (!cols.length) throw new AppError('No fields provided.');
      const values = cols.map((f) => req.body[f]);
      const setSql = cols.map((f, i) => `${f} = $${i + 1}`).join(', ');
      values.push(req.params.id);
      const { rows } = await pool.query(`UPDATE ${table} SET ${setSql} WHERE id = $${values.length} RETURNING *`, values);
      if (!rows[0]) throw new AppError('Not found.', 404);
      res.json(rows[0]);
    } catch (err) { next(err); }
  });

  r.delete('/:id', requireRole('super_admin'), async (req, res, next) => {
    try {
      await pool.query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
      res.json({ message: 'Deleted.' });
    } catch (err) { next(err); }
  });

  return r;
}

router.use('/sources', simpleResource('lead_sources', ['name', 'is_active'], { orderBy: 'name' }));
router.use('/campaigns', simpleResource('campaigns', ['name', 'source_id', 'ad_name', 'is_active'], { orderBy: 'created_at DESC' }));
router.use('/tags', simpleResource('tags', ['name', 'color'], { orderBy: 'name' }));
router.use('/statuses', simpleResource('lead_statuses', ['name', 'sort_order', 'color', 'is_won', 'is_lost', 'is_active'], { orderBy: 'sort_order' }));

router.use('/universities', simpleResource('universities', ['name', 'country', 'city', 'is_active', 'commission_type', 'commission_value'], { orderBy: 'name' }));

router.use('/courses', simpleResource(
  'courses',
  ['university_id', 'name', 'specialization', 'fees', 'duration', 'eligibility', 'mode', 'admission_status', 'is_active'],
  { orderBy: 'name' }
));

// Courses with university name joined (convenience read endpoint used by dropdowns)
router.get('/courses-detailed', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, u.name AS university_name FROM courses c
      LEFT JOIN universities u ON u.id = c.university_id
      WHERE c.is_active = TRUE ORDER BY u.name, c.name
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
