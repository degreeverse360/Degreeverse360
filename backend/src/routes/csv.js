const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity, logAudit } = require('../utils/logging');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const REQUIRED = ['Name', 'Mobile'];
const EXPECTED_HEADERS = [
  'Lead ID', 'Name', 'Mobile', 'WhatsApp', 'Email', 'City', 'State', 'Source', 'Campaign',
  'Ad Name', 'Course', 'University', 'Status', 'Priority', 'Assigned Counselor',
  'Follow-up Date', 'Follow-up Time', 'Remarks', 'Created Date',
];

// ---------- POST /api/csv/preview  (parse + validate, no DB writes) ----------
router.post('/preview', requireRole('super_admin', 'admin'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('No CSV file uploaded.');
    const records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });

    const [existingMobiles, statuses, sources, counselors] = await Promise.all([
      pool.query('SELECT mobile FROM leads'),
      pool.query('SELECT name FROM lead_statuses'),
      pool.query('SELECT name FROM lead_sources'),
      pool.query("SELECT name FROM users WHERE is_active = TRUE"),
    ]);
    const mobileSet = new Set(existingMobiles.rows.map((r) => r.mobile));
    const statusSet = new Set(statuses.rows.map((r) => r.name));
    const sourceSet = new Set(sources.rows.map((r) => r.name));
    const counselorSet = new Set(counselors.rows.map((r) => r.name));

    const seenInFile = new Set();
    const preview = records.map((row, idx) => {
      const errors = [];
      for (const field of REQUIRED) {
        if (!row[field] || !row[field].trim()) errors.push(`Missing required field: ${field}`);
      }
      if (row.Mobile) {
        if (!/^[0-9+\-\s]{7,15}$/.test(row.Mobile)) errors.push('Invalid mobile number format');
        if (mobileSet.has(row.Mobile)) errors.push('Duplicate: mobile already exists in CRM');
        if (seenInFile.has(row.Mobile)) errors.push('Duplicate: repeated within this file');
        seenInFile.add(row.Mobile);
      }
      if (row.Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.Email)) errors.push('Invalid email format');
      if (row.Status && !statusSet.has(row.Status)) errors.push(`Unknown status "${row.Status}" (will default to New)`);
      if (row.Source && !sourceSet.has(row.Source)) errors.push(`Unknown source "${row.Source}" (will be left blank)`);
      if (row['Assigned Counselor'] && !counselorSet.has(row['Assigned Counselor'])) errors.push(`Unknown counselor "${row['Assigned Counselor']}"`);

      return { row: idx + 1, data: row, errors, valid: errors.filter(e => !e.startsWith('Unknown')).length === 0 };
    });

    res.json({
      totalRows: records.length,
      validRows: preview.filter((p) => p.valid).length,
      invalidRows: preview.filter((p) => !p.valid).length,
      preview,
    });
  } catch (err) { next(err); }
});

// ---------- POST /api/csv/import  (commits only the rows the client marks as approved) ----------
router.post('/import', requireRole('super_admin', 'admin'), express.json({ limit: '5mb' }), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { rows: approvedRows, fileName } = req.body; // array of row `data` objects, pre-filtered by client to valid-only
    if (!Array.isArray(approvedRows) || !approvedRows.length) throw new AppError('No rows to import.');

    await client.query('BEGIN');

    const [statuses, sources, counselors, courses, universities] = await Promise.all([
      client.query('SELECT id, name FROM lead_statuses'),
      client.query('SELECT id, name FROM lead_sources'),
      client.query('SELECT id, name FROM users'),
      client.query('SELECT id, name FROM courses'),
      client.query('SELECT id, name FROM universities'),
    ]);
    const statusMap = Object.fromEntries(statuses.rows.map((r) => [r.name, r.id]));
    const sourceMap = Object.fromEntries(sources.rows.map((r) => [r.name, r.id]));
    const counselorMap = Object.fromEntries(counselors.rows.map((r) => [r.name, r.id]));
    const courseMap = Object.fromEntries(courses.rows.map((r) => [r.name, r.id]));
    const universityMap = Object.fromEntries(universities.rows.map((r) => [r.name, r.id]));
    const newStatusId = statusMap['New'];

    let success = 0;
    const errors = [];

    for (const row of approvedRows) {
      try {
        const { rows: seq } = await client.query("SELECT nextval('lead_code_seq') AS n");
        const leadCode = `DGV-${String(seq[0].n).padStart(6, '0')}`;
        const counselorId = counselorMap[row['Assigned Counselor']] || null;

        const { rows: inserted } = await client.query(
          `INSERT INTO leads (
            lead_code, full_name, mobile, whatsapp_number, email, city, state, source_id,
            ad_name, interested_course_id, interested_university_id, status_id, priority,
            assigned_counselor_id, lead_owner_id, next_followup_date, next_followup_time, remarks, created_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
          [
            leadCode, row.Name, row.Mobile, row.WhatsApp || null, row.Email || null, row.City || null, row.State || null,
            sourceMap[row.Source] || null, row['Ad Name'] || null,
            courseMap[row.Course] || null, universityMap[row.University] || null,
            statusMap[row.Status] || newStatusId, row.Priority || 'Medium',
            counselorId, req.user.id,
            row['Follow-up Date'] || null, row['Follow-up Time'] || null, row.Remarks || null, req.user.id,
          ]
        );
        await logActivity(client, { leadId: inserted[0].id, userId: req.user.id, action: 'lead_created', notes: `Imported via CSV (${fileName || 'unnamed file'})` });
        success++;
      } catch (rowErr) {
        errors.push({ row, error: rowErr.message });
      }
    }

    await client.query(
      `INSERT INTO import_batches (imported_by, file_name, total_rows, success_count, error_count, error_report)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.user.id, fileName || null, approvedRows.length, success, errors.length, JSON.stringify(errors)]
    );

    await client.query('COMMIT');
    await logAudit({ userId: req.user.id, entityType: 'lead', action: 'import', details: { success, errors: errors.length } });

    res.json({ imported: success, failed: errors.length, errors });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ---------- GET /api/csv/export  (respects the same filters as the leads list) ----------
router.get('/export', async (req, res, next) => {
  try {
    const where = [];
    const values = [];
    if (req.user.role === 'counselor') { values.push(req.user.id); where.push(`l.assigned_counselor_id = $${values.length}`); }
    if (req.query.status) { values.push(req.query.status.split(',')); where.push(`ls.name = ANY($${values.length})`); }
    if (req.query.source) { values.push(req.query.source.split(',')); where.push(`src.name = ANY($${values.length})`); }
    if (req.query.counselor) { values.push(req.query.counselor); where.push(`l.assigned_counselor_id = $${values.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows } = await pool.query(`
      SELECT l.lead_code AS "Lead ID", l.full_name AS "Name", l.mobile AS "Mobile", l.whatsapp_number AS "WhatsApp",
        l.email AS "Email", l.city AS "City", l.state AS "State", src.name AS "Source", camp.name AS "Campaign",
        l.ad_name AS "Ad Name", c.name AS "Course", uni.name AS "University", ls.name AS "Status", l.priority AS "Priority",
        u.name AS "Assigned Counselor", l.next_followup_date AS "Follow-up Date", l.next_followup_time AS "Follow-up Time",
        l.remarks AS "Remarks", l.created_at AS "Created Date"
      FROM leads l
      LEFT JOIN lead_statuses ls ON ls.id = l.status_id
      LEFT JOIN lead_sources src ON src.id = l.source_id
      LEFT JOIN campaigns camp ON camp.id = l.campaign_id
      LEFT JOIN users u ON u.id = l.assigned_counselor_id
      LEFT JOIN courses c ON c.id = l.interested_course_id
      LEFT JOIN universities uni ON uni.id = l.interested_university_id
      ${whereSql}
      ORDER BY l.created_at DESC
    `, values);

    const csv = stringify(rows, { header: true });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="degreeverse360-leads-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
});

module.exports = router;
