const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM whatsapp_templates ORDER BY name');
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', requireRole('super_admin', 'admin'), async (req, res, next) => {
  try {
    const { name, category, content } = req.body;
    if (!name || !content) throw new AppError('Template name and content are required.');
    const { rows } = await pool.query(
      'INSERT INTO whatsapp_templates (name, category, content, created_by) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, category || null, content, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.patch('/:id', requireRole('super_admin', 'admin'), async (req, res, next) => {
  try {
    const fields = []; const values = []; let i = 1;
    ['name', 'category', 'content'].forEach((key) => {
      if (req.body[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(req.body[key]); }
    });
    if (!fields.length) throw new AppError('No fields to update.');
    values.push(req.params.id);
    const { rows } = await pool.query(`UPDATE whatsapp_templates SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    if (!rows[0]) throw new AppError('Template not found.', 404);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('super_admin', 'admin'), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM whatsapp_templates WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted.' });
  } catch (err) { next(err); }
});

module.exports = router;
