const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function visibility(req, values, where) {
  if (req.user.role === 'counselor') {
    values.push(req.user.id);
    where.push(`al.assigned_counselor_id = $${values.length}`);
  }
}

async function logAsgActivity(client, { leadId, userId, action, oldValue = null, newValue = null, notes = null }) {
  await client.query(
    `INSERT INTO assignment_activities (assignment_lead_id, user_id, action, old_value, new_value, notes) VALUES ($1,$2,$3,$4,$5,$6)`,
    [leadId, userId, action, oldValue, newValue, notes]
  );
}

const LEAD_SELECT = `
  SELECT al.*, (al.deal_amount - al.paid_amount) AS pending_amount,
    u.name AS counselor_name, u.avatar_color AS counselor_color
  FROM assignment_leads al
  LEFT JOIN users u ON u.id = al.assigned_counselor_id
`;

// ---------- GET /api/assignment-leads  (list) ----------
router.get('/', async (req, res, next) => {
  try {
    const { search, status, university, semester, course, counselor, priority, deadline, page = 1, pageSize = 25, sortBy = 'created_at', sortDir = 'desc' } = req.query;
    const where = [];
    const values = [];
    visibility(req, values, where);

    if (search) {
      values.push(`%${search}%`);
      const i = values.length;
      where.push(`(al.full_name ILIKE $${i} OR al.mobile ILIKE $${i} OR al.email ILIKE $${i} OR al.lead_code ILIKE $${i})`);
    }
    if (status) { values.push(status.split(',')); where.push(`al.status = ANY($${values.length})`); }
    if (university) { values.push(`%${university}%`); where.push(`al.university_name ILIKE $${values.length}`); }
    if (semester) { values.push(semester); where.push(`al.semester = $${values.length}`); }
    if (course) { values.push(`%${course}%`); where.push(`al.course ILIKE $${values.length}`); }
    if (counselor) { values.push(counselor); where.push(`al.assigned_counselor_id = $${values.length}`); }
    if (priority) { values.push(priority); where.push(`al.priority = $${values.length}`); }
    if (deadline === 'overdue') where.push(`al.last_submission_date < CURRENT_DATE`);
    if (deadline === 'due_soon') where.push(`al.last_submission_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '2 days'`);
    if (deadline === 'this_week') where.push(`al.last_submission_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'`);
    if (deadline === 'upcoming') where.push(`al.last_submission_date > CURRENT_DATE + INTERVAL '7 days'`);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const allowedSort = ['created_at', 'full_name', 'last_submission_date', 'deal_amount'];
    const sortCol = allowedSort.includes(sortBy) ? `al.${sortBy}` : 'al.created_at';
    const dir = sortDir.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(parseInt(pageSize, 10) || 25, 200);
    const offset = (Math.max(parseInt(page, 10), 1) - 1) * limit;

    const { rows: countRows } = await pool.query(`SELECT COUNT(*) FROM assignment_leads al ${whereSql}`, values);
    values.push(limit, offset);
    const { rows } = await pool.query(`${LEAD_SELECT} ${whereSql} ORDER BY ${sortCol} ${dir} LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    res.json({ data: rows, pagination: { page: Number(page), pageSize: limit, total: Number(countRows[0].count) } });
  } catch (err) { next(err); }
});

// ---------- GET /api/assignment-leads/summary ----------
router.get('/summary', async (req, res, next) => {
  try {
    const vis = req.user.role === 'counselor' ? `AND al.assigned_counselor_id = ${req.user.id}` : '';
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'New') AS new_count,
        COUNT(*) FILTER (WHERE status NOT IN ('Completed','Cancelled')) AS in_progress,
        COUNT(*) FILTER (WHERE status = 'Completed') AS completed,
        COALESCE(SUM(deal_amount), 0) AS total_revenue,
        COALESCE(SUM(deal_amount - paid_amount), 0) AS pending_payments,
        COUNT(*) FILTER (WHERE last_submission_date < CURRENT_DATE AND status NOT IN ('Completed','Cancelled')) AS overdue,
        COUNT(*) FILTER (WHERE last_submission_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '2 days' AND status NOT IN ('Completed','Cancelled')) AS due_soon,
        COUNT(*) FILTER (WHERE last_submission_date BETWEEN CURRENT_DATE + INTERVAL '3 days' AND CURRENT_DATE + INTERVAL '7 days' AND status NOT IN ('Completed','Cancelled')) AS due_week,
        COUNT(*) FILTER (WHERE last_submission_date > CURRENT_DATE + INTERVAL '7 days' AND status NOT IN ('Completed','Cancelled')) AS upcoming
      FROM assignment_leads al WHERE 1=1 ${vis}
    `);
    const { rows: pendingFollowups } = await pool.query(`
      SELECT COUNT(*) AS c FROM assignment_followups f JOIN assignment_leads al ON al.id = f.assignment_lead_id
      WHERE f.status = 'Pending' AND f.scheduled_date <= CURRENT_DATE ${vis}
    `);
    res.json({ ...rows[0], pending_followups: pendingFollowups[0].c });
  } catch (err) { next(err); }
});

// ---------- GET /api/assignment-leads/:id ----------
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const where = ['al.id = $1'];
    const values = [id];
    visibility(req, values, where);
    const { rows } = await pool.query(`${LEAD_SELECT} WHERE ${where.join(' AND ')}`, values);
    if (!rows[0]) throw new AppError('Assignment lead not found or you do not have access to it.', 404);

    const [items, documents, payments, followups, notes, activities] = await Promise.all([
      pool.query(`SELECT * FROM assignment_items WHERE assignment_lead_id = $1 ORDER BY due_date ASC NULLS LAST, id ASC`, [id]),
      pool.query(`SELECT d.*, u.name AS uploaded_by_name FROM assignment_documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.assignment_lead_id = $1 ORDER BY d.uploaded_at DESC`, [id]),
      pool.query(`SELECT * FROM assignment_payments WHERE assignment_lead_id = $1 ORDER BY payment_date DESC`, [id]),
      pool.query(`SELECT f.*, u.name AS created_by_name FROM assignment_followups f LEFT JOIN users u ON u.id = f.created_by WHERE f.assignment_lead_id = $1 ORDER BY f.scheduled_date DESC`, [id]),
      pool.query(`SELECT n.*, u.name AS created_by_name FROM assignment_notes n LEFT JOIN users u ON u.id = n.created_by WHERE n.assignment_lead_id = $1 ORDER BY n.created_at DESC`, [id]),
      pool.query(`SELECT a.*, u.name AS user_name FROM assignment_activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.assignment_lead_id = $1 ORDER BY a.created_at DESC LIMIT 200`, [id]),
    ]);
    res.json({ ...rows[0], items: items.rows, documents: documents.rows, payments: payments.rows, followups: followups.rows, notes: notes.rows, activities: activities.rows });
  } catch (err) { next(err); }
});

// ---------- POST /api/assignment-leads ----------
router.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const b = req.body;
    if (!b.full_name || !b.mobile) throw new AppError('Full name and mobile number are required.');
    if (Number(b.paid_amount || 0) > Number(b.deal_amount || 0)) throw new AppError('Paid amount cannot exceed the deal amount.');

    const { rows: dupes } = await client.query('SELECT id, lead_code FROM assignment_leads WHERE mobile = $1', [b.mobile]);
    if (dupes.length && !b.force) {
      await client.query('ROLLBACK');
      return res.status(409).json({ warning: 'duplicate_mobile', message: `An assignment lead with this mobile already exists (${dupes[0].lead_code}).`, existing: dupes[0] });
    }

    const { rows: seq } = await client.query("SELECT nextval('assignment_lead_code_seq') AS n");
    const leadCode = `ASG${String(seq[0].n).padStart(5, '0')}`;
    const counselorId = b.assigned_counselor_id || (req.user.role === 'counselor' ? req.user.id : null);

    const { rows } = await client.query(
      `INSERT INTO assignment_leads (lead_code, full_name, mobile, email, university_name, semester, course, pursuing,
        assignment_count, last_submission_date, status, priority, assignment_notes, deal_amount, paid_amount,
        assigned_counselor_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'New'),COALESCE($12,'Medium'),$13,$14,$15,$16,$17)
       RETURNING id, lead_code`,
      [leadCode, b.full_name, b.mobile, b.email || null, b.university_name || null, b.semester || null, b.course || null,
        b.pursuing || null, b.assignment_count || 0, b.last_submission_date || null, b.status, b.priority,
        b.assignment_notes || null, b.deal_amount || 0, b.paid_amount || 0, counselorId, req.user.id]
    );
    await logAsgActivity(client, { leadId: rows[0].id, userId: req.user.id, action: 'lead_created' });
    if (counselorId) await logAsgActivity(client, { leadId: rows[0].id, userId: req.user.id, action: 'assigned', newValue: String(counselorId) });

    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ---------- PATCH /api/assignment-leads/:id ----------
router.patch('/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const b = req.body;

    const visWhere = ['id = $1'];
    const visValues = [id];
    if (req.user.role === 'counselor') { visValues.push(req.user.id); visWhere.push(`assigned_counselor_id = $${visValues.length}`); }
    const { rows: currentRows } = await client.query(`SELECT * FROM assignment_leads WHERE ${visWhere.join(' AND ')}`, visValues);
    const current = currentRows[0];
    if (!current) throw new AppError('Assignment lead not found or you do not have access to it.', 404);

    const dealAmt = b.deal_amount !== undefined ? Number(b.deal_amount) : Number(current.deal_amount);
    const paidAmt = b.paid_amount !== undefined ? Number(b.paid_amount) : Number(current.paid_amount);
    if (paidAmt > dealAmt) throw new AppError('Paid amount cannot exceed the deal amount.');

    const editable = ['full_name', 'mobile', 'email', 'university_name', 'semester', 'course', 'pursuing',
      'assignment_count', 'last_submission_date', 'status', 'priority', 'assignment_notes', 'deal_amount', 'paid_amount', 'assigned_counselor_id'];
    const fields = [];
    const values = [];
    let i = 1;
    for (const key of editable) {
      if (b[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(b[key]); }
    }
    if (!fields.length) throw new AppError('No fields to update.');
    values.push(id);
    const { rows: updated } = await client.query(`UPDATE assignment_leads SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);

    if (b.status !== undefined && b.status !== current.status) {
      await logAsgActivity(client, { leadId: id, userId: req.user.id, action: 'status_changed', oldValue: current.status, newValue: b.status });
    }
    if (b.assigned_counselor_id !== undefined && String(b.assigned_counselor_id) !== String(current.assigned_counselor_id)) {
      await logAsgActivity(client, { leadId: id, userId: req.user.id, action: 'reassigned', oldValue: String(current.assigned_counselor_id), newValue: String(b.assigned_counselor_id) });
    }
    await client.query('COMMIT');
    res.json({ ...updated[0], pending_amount: Number(updated[0].deal_amount) - Number(updated[0].paid_amount) });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ---------- Assignment items (the individual assignment tracker) ----------
router.post('/:id/items', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { title, subject, due_date, file_url } = req.body;
    if (!title) throw new AppError('Assignment title is required.');
    const { rows } = await client.query(
      `INSERT INTO assignment_items (assignment_lead_id, title, subject, due_date, file_url, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, title, subject || null, due_date || null, file_url || null, req.user.id]
    );
    await logAsgActivity(client, { leadId: id, userId: req.user.id, action: 'assignment_added', newValue: title });
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); } finally { client.release(); }
});

router.patch('/items/:itemId', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { itemId } = req.params;
    const editable = ['title', 'subject', 'due_date', 'status', 'file_url'];
    const fields = []; const values = []; let i = 1;
    for (const key of editable) if (req.body[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(req.body[key]); }
    if (!fields.length) throw new AppError('No fields to update.');
    values.push(itemId);
    const { rows } = await client.query(`UPDATE assignment_items SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    if (!rows[0]) throw new AppError('Assignment item not found.', 404);
    if (req.body.status) await logAsgActivity(client, { leadId: rows[0].assignment_lead_id, userId: req.user.id, action: 'assignment_status_changed', newValue: `${rows[0].title}: ${req.body.status}` });
    if (req.body.file_url) await logAsgActivity(client, { leadId: rows[0].assignment_lead_id, userId: req.user.id, action: 'assignment_file_uploaded', newValue: rows[0].title });
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); } finally { client.release(); }
});

// ---------- Documents ----------
router.post('/:id/documents', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { doc_name, doc_type, file_url } = req.body;
    if (!doc_name || !file_url) throw new AppError('Document name and file link are required.');
    const { rows } = await pool.query(
      `INSERT INTO assignment_documents (assignment_lead_id, doc_name, doc_type, file_url, uploaded_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, doc_name, doc_type || null, file_url, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});
router.delete('/documents/:docId', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM assignment_documents WHERE id = $1', [req.params.docId]);
    res.json({ message: 'Deleted.' });
  } catch (err) { next(err); }
});

// ---------- Payments ----------
router.post('/:id/payments', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { amount, payment_date, payment_method, notes } = req.body;
    if (!amount || Number(amount) <= 0) throw new AppError('A valid payment amount is required.');
    const { rows: lead } = await client.query('SELECT deal_amount, paid_amount FROM assignment_leads WHERE id = $1', [id]);
    if (!lead[0]) throw new AppError('Assignment lead not found.', 404);
    const newPaid = Number(lead[0].paid_amount) + Number(amount);
    if (newPaid > Number(lead[0].deal_amount)) throw new AppError('This payment would exceed the deal amount.');

    const { rows } = await client.query(
      `INSERT INTO assignment_payments (assignment_lead_id, amount, payment_date, payment_method, notes, created_by) VALUES ($1,$2,COALESCE($3,CURRENT_DATE),$4,$5,$6) RETURNING *`,
      [id, amount, payment_date || null, payment_method || null, notes || null, req.user.id]
    );
    await client.query('UPDATE assignment_leads SET paid_amount = $1 WHERE id = $2', [newPaid, id]);
    await logAsgActivity(client, { leadId: id, userId: req.user.id, action: 'payment_updated', newValue: `₹${amount} received` });
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); } finally { client.release(); }
});

// ---------- Follow-ups ----------
router.get('/followups/list', async (req, res, next) => {
  try {
    const { range = 'today' } = req.query;
    let dateFilter = "f.status = 'Pending'";
    if (range === 'today') dateFilter += " AND f.scheduled_date = CURRENT_DATE";
    else if (range === 'overdue') dateFilter += " AND f.scheduled_date < CURRENT_DATE";
    else if (range === 'upcoming') dateFilter += " AND f.scheduled_date > CURRENT_DATE";
    const vis = req.user.role === 'counselor' ? `AND al.assigned_counselor_id = ${req.user.id}` : '';
    const { rows } = await pool.query(`
      SELECT f.*, al.full_name, al.mobile, al.lead_code FROM assignment_followups f
      JOIN assignment_leads al ON al.id = f.assignment_lead_id
      WHERE ${dateFilter} ${vis} ORDER BY f.scheduled_date ASC
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/:id/followups', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { scheduled_date, scheduled_time, followup_type, notes } = req.body;
    if (!scheduled_date) throw new AppError('Follow-up date is required.');
    const { rows } = await client.query(
      `INSERT INTO assignment_followups (assignment_lead_id, scheduled_date, scheduled_time, followup_type, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, scheduled_date, scheduled_time || null, followup_type || 'Call', notes || null, req.user.id]
    );
    await logAsgActivity(client, { leadId: id, userId: req.user.id, action: 'followup_created', newValue: `${scheduled_date} (${followup_type || 'Call'})` });
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); } finally { client.release(); }
});

router.patch('/followups/:fid', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { fid } = req.params;
    const fields = []; const values = []; let i = 1;
    ['status', 'scheduled_date', 'scheduled_time', 'notes'].forEach((key) => {
      if (req.body[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(req.body[key]); }
    });
    if (req.body.status === 'Completed') fields.push('completed_at = now()');
    if (!fields.length) throw new AppError('No fields to update.');
    values.push(fid);
    const { rows } = await client.query(`UPDATE assignment_followups SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    if (!rows[0]) throw new AppError('Follow-up not found.', 404);
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); } finally { client.release(); }
});

// ---------- Notes ----------
router.post('/:id/notes', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { content } = req.body;
    if (!content) throw new AppError('Note content is required.');
    const { rows } = await client.query(
      `INSERT INTO assignment_notes (assignment_lead_id, content, created_by) VALUES ($1,$2,$3) RETURNING *`, [id, content, req.user.id]
    );
    await logAsgActivity(client, { leadId: id, userId: req.user.id, action: 'note_added', notes: content.slice(0, 140) });
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); } finally { client.release(); }
});

// ---------- CSV import ----------
const REQUIRED = ['Name', 'Mobile Number'];
router.post('/csv/preview', requireRole('super_admin', 'admin'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('No file uploaded.');
    const records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
    const { rows: existing } = await pool.query('SELECT mobile FROM assignment_leads');
    const mobileSet = new Set(existing.rows ? existing.rows.map((r) => r.mobile) : existing.map((r) => r.mobile));
    const seen = new Set();
    const preview = records.map((row, idx) => {
      const errors = [];
      for (const f of REQUIRED) if (!row[f] || !row[f].trim()) errors.push(`Missing: ${f}`);
      if (row['Mobile Number']) {
        if (mobileSet.has(row['Mobile Number'])) errors.push('Duplicate: already exists');
        if (seen.has(row['Mobile Number'])) errors.push('Duplicate: repeated in file');
        seen.add(row['Mobile Number']);
      }
      const paid = Number(row['Amount Paid'] || 0);
      const deal = Number(row['Deal Amount'] || 0);
      if (paid > deal) errors.push('Paid amount exceeds deal amount');
      return { row: idx + 1, data: row, errors, valid: errors.length === 0 };
    });
    res.json({ totalRows: records.length, validRows: preview.filter((p) => p.valid).length, invalidRows: preview.filter((p) => !p.valid).length, preview });
  } catch (err) { next(err); }
});

router.post('/csv/import', requireRole('super_admin', 'admin'), express.json({ limit: '5mb' }), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { rows: approvedRows, fileName } = req.body;
    if (!Array.isArray(approvedRows) || !approvedRows.length) throw new AppError('No rows to import.');
    await client.query('BEGIN');
    let success = 0;
    const errors = [];
    for (const row of approvedRows) {
      try {
        const { rows: seq } = await client.query("SELECT nextval('assignment_lead_code_seq') AS n");
        const leadCode = `ASG${String(seq[0].n).padStart(5, '0')}`;
        const { rows: inserted } = await client.query(
          `INSERT INTO assignment_leads (lead_code, full_name, mobile, email, university_name, semester, course, pursuing,
            assignment_count, last_submission_date, deal_amount, paid_amount, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
          [leadCode, row.Name, row['Mobile Number'], row.Email || null, row['University Name'] || null, row.Semester || null,
            row.Course || null, row.Pursuing || null, Number(row['Assignment Count'] || 0), row['Last Date of Assignment Submission'] || null,
            Number(row['Deal Amount'] || 0), Number(row['Amount Paid'] || 0), req.user.id]
        );
        await logAsgActivity(client, { leadId: inserted[0].id, userId: req.user.id, action: 'lead_created', notes: `Imported via CSV (${fileName || 'file'})` });
        success++;
      } catch (rowErr) { errors.push({ row, error: rowErr.message }); }
    }
    await client.query(
      `INSERT INTO assignment_import_batches (imported_by, file_name, total_rows, success_count, error_count, error_report) VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.user.id, fileName || null, approvedRows.length, success, errors.length, JSON.stringify(errors)]
    );
    await client.query('COMMIT');
    res.json({ imported: success, failed: errors.length, errors });
  } catch (err) { await client.query('ROLLBACK'); next(err); } finally { client.release(); }
});

router.get('/csv/history', requireRole('super_admin', 'admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT b.*, u.name AS imported_by_name FROM assignment_import_batches b
      LEFT JOIN users u ON u.id = b.imported_by ORDER BY b.created_at DESC LIMIT 20
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
