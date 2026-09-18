const express = require('express');
const { stringify } = require('csv-stringify/sync');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('super_admin', 'admin'));

function dateRange(req) {
  const from = req.query.dateFrom || '1900-01-01';
  const to = req.query.dateTo || '2999-12-31';
  return { from, to };
}

function respond(req, res, rows) {
  if (req.query.format === 'csv') {
    const csv = stringify(rows, { header: true });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="report-${Date.now()}.csv"`);
    return res.send(csv);
  }
  res.json(rows);
}

// ---------- GET /api/reports/leads-over-time?groupBy=day|month ----------
router.get('/leads-over-time', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const bucket = req.query.groupBy === 'month' ? "date_trunc('month', created_at)" : "date_trunc('day', created_at)";
    const { rows } = await pool.query(`
      SELECT ${bucket} AS period, COUNT(*) AS leads
      FROM leads WHERE created_at::date BETWEEN $1 AND $2
      GROUP BY period ORDER BY period
    `, [from, to]);
    respond(req, res, rows);
  } catch (err) { next(err); }
});

// ---------- GET /api/reports/source-performance ----------
router.get('/source-performance', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const { rows } = await pool.query(`
      SELECT COALESCE(src.name, 'Unknown') AS source, COUNT(*) AS leads,
        COUNT(*) FILTER (WHERE ls.is_won) AS enrolled,
        ROUND(100.0 * COUNT(*) FILTER (WHERE ls.is_won) / NULLIF(COUNT(*),0), 1) AS conversion_rate
      FROM leads l
      LEFT JOIN lead_sources src ON src.id = l.source_id
      LEFT JOIN lead_statuses ls ON ls.id = l.status_id
      WHERE l.created_at::date BETWEEN $1 AND $2
      GROUP BY src.name ORDER BY leads DESC
    `, [from, to]);
    respond(req, res, rows);
  } catch (err) { next(err); }
});

// ---------- GET /api/reports/campaign-performance ----------
router.get('/campaign-performance', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const { rows } = await pool.query(`
      SELECT COALESCE(camp.name, 'Unknown') AS campaign, COUNT(*) AS leads,
        COUNT(*) FILTER (WHERE ls.is_won) AS enrolled
      FROM leads l
      LEFT JOIN campaigns camp ON camp.id = l.campaign_id
      LEFT JOIN lead_statuses ls ON ls.id = l.status_id
      WHERE l.created_at::date BETWEEN $1 AND $2
      GROUP BY camp.name ORDER BY leads DESC
    `, [from, to]);
    respond(req, res, rows);
  } catch (err) { next(err); }
});

// ---------- GET /api/reports/counselor-performance ----------
router.get('/counselor-performance', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const { rows } = await pool.query(`
      SELECT u.name AS counselor, COUNT(l.id) AS assigned,
        COUNT(l.id) FILTER (WHERE ls.is_won) AS enrolled,
        COUNT(l.id) FILTER (WHERE ls.is_lost) AS lost,
        ROUND(100.0 * COUNT(l.id) FILTER (WHERE ls.is_won) / NULLIF(COUNT(l.id),0), 1) AS conversion_rate,
        (SELECT COUNT(*) FROM followups f JOIN leads l2 ON l2.id = f.lead_id
           WHERE l2.assigned_counselor_id = u.id AND f.status = 'Completed'
           AND f.scheduled_date BETWEEN $1 AND $2) AS followups_completed
      FROM users u
      JOIN roles r ON r.id = u.role_id AND r.name = 'counselor'
      LEFT JOIN leads l ON l.assigned_counselor_id = u.id AND l.created_at::date BETWEEN $1 AND $2
      LEFT JOIN lead_statuses ls ON ls.id = l.status_id
      GROUP BY u.id, u.name ORDER BY enrolled DESC
    `, [from, to]);
    respond(req, res, rows);
  } catch (err) { next(err); }
});

// ---------- GET /api/reports/course-performance ----------
router.get('/course-performance', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const { rows } = await pool.query(`
      SELECT c.name AS course, uni.name AS university, COUNT(l.id) AS leads,
        COUNT(l.id) FILTER (WHERE ls.is_won) AS enrolled
      FROM courses c
      LEFT JOIN universities uni ON uni.id = c.university_id
      LEFT JOIN leads l ON l.interested_course_id = c.id AND l.created_at::date BETWEEN $1 AND $2
      LEFT JOIN lead_statuses ls ON ls.id = l.status_id
      GROUP BY c.name, uni.name ORDER BY leads DESC
    `, [from, to]);
    respond(req, res, rows);
  } catch (err) { next(err); }
});

// ---------- GET /api/reports/enrollment ----------
router.get('/enrollment', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const { rows } = await pool.query(`
      SELECT l.lead_code, l.full_name, l.mobile, c.name AS course, uni.name AS university,
        u.name AS counselor, l.updated_at AS enrolled_date
      FROM leads l
      JOIN lead_statuses ls ON ls.id = l.status_id AND ls.is_won
      LEFT JOIN courses c ON c.id = l.interested_course_id
      LEFT JOIN universities uni ON uni.id = l.interested_university_id
      LEFT JOIN users u ON u.id = l.assigned_counselor_id
      WHERE l.updated_at::date BETWEEN $1 AND $2
      ORDER BY l.updated_at DESC
    `, [from, to]);
    respond(req, res, rows);
  } catch (err) { next(err); }
});

// ---------- GET /api/reports/lost-leads ----------
router.get('/lost-leads', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const { rows } = await pool.query(`
      SELECT l.lead_code, l.full_name, l.mobile, ls.name AS status, src.name AS source,
        u.name AS counselor, l.remarks, l.updated_at AS lost_date
      FROM leads l
      JOIN lead_statuses ls ON ls.id = l.status_id AND ls.is_lost
      LEFT JOIN lead_sources src ON src.id = l.source_id
      LEFT JOIN users u ON u.id = l.assigned_counselor_id
      WHERE l.updated_at::date BETWEEN $1 AND $2
      ORDER BY l.updated_at DESC
    `, [from, to]);
    respond(req, res, rows);
  } catch (err) { next(err); }
});

// ---------- GET /api/reports/followups ----------
router.get('/followups', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const { rows } = await pool.query(`
      SELECT l.lead_code, l.full_name, u.name AS counselor, f.followup_type, f.scheduled_date,
        f.scheduled_time, f.status, f.notes
      FROM followups f
      JOIN leads l ON l.id = f.lead_id
      LEFT JOIN users u ON u.id = l.assigned_counselor_id
      WHERE f.scheduled_date BETWEEN $1 AND $2
      ORDER BY f.scheduled_date DESC
    `, [from, to]);
    respond(req, res, rows);
  } catch (err) { next(err); }
});

module.exports = router;
