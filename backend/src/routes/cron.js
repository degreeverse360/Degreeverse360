const express = require('express');
const pool = require('../config/db');

const router = express.Router();

/**
 * This route is NOT behind requireAuth — it's designed to be called by an
 * external free scheduler (e.g. cron-job.org) every 15-30 minutes. It's
 * protected instead by a shared secret in the query string.
 */
function checkSecret(req, res, next) {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'Invalid or missing secret.' });
  }
  next();
}

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping email send.');
    return { skipped: true };
  }
  const fromAddress = process.env.ALERT_FROM_EMAIL || 'Degreeverse360 <onboarding@resend.dev>';
  const recipients = [to];
  if (process.env.ADMIN_ALERT_EMAIL) recipients.push(process.env.ADMIN_ALERT_EMAIL);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: fromAddress, to: recipients, subject, html }),
  });
  if (!response.ok) {
    const errText = await response.text();
    console.error('Resend send failed:', errText);
    return { error: errText };
  }
  return response.json();
}

// ---------- GET /api/cron/check-followups?secret=XXX ----------
router.get('/check-followups', checkSecret, async (req, res, next) => {
  try {
    let sentCount = 0;

    // --- Main CRM leads: missed follow-ups ---
    const { rows: missedLeadFollowups } = await pool.query(`
      SELECT f.id, f.scheduled_date, f.scheduled_time, f.followup_type, f.notes,
        l.full_name, l.lead_code, l.mobile, u.name AS counselor_name, u.email AS counselor_email
      FROM followups f
      JOIN leads l ON l.id = f.lead_id
      LEFT JOIN users u ON u.id = l.assigned_counselor_id
      WHERE f.status = 'Pending' AND f.scheduled_date < CURRENT_DATE AND f.alerted_at IS NULL
        AND u.email IS NOT NULL
    `);
    for (const f of missedLeadFollowups) {
      await sendEmail({
        to: f.counselor_email,
        subject: `Missed follow-up: ${f.full_name} (${f.lead_code})`,
        html: `
          <p>Hi ${f.counselor_name || 'there'},</p>
          <p>A follow-up you scheduled was due on <strong>${f.scheduled_date}</strong>${f.scheduled_time ? ` at ${f.scheduled_time}` : ''} and hasn't been marked complete yet.</p>
          <p><strong>Lead:</strong> ${f.full_name} (${f.lead_code})<br/>
          <strong>Mobile:</strong> ${f.mobile}<br/>
          <strong>Type:</strong> ${f.followup_type}${f.notes ? `<br/><strong>Notes:</strong> ${f.notes}` : ''}</p>
          <p>Please follow up as soon as possible.</p>
          <p>— Degreeverse360 CRM</p>
        `,
      });
      await pool.query('UPDATE followups SET alerted_at = now() WHERE id = $1', [f.id]);
      sentCount++;
    }

    // --- Assignment leads: missed follow-ups ---
    const { rows: missedAsgFollowups } = await pool.query(`
      SELECT f.id, f.scheduled_date, f.scheduled_time, f.followup_type, f.notes,
        al.full_name, al.lead_code, al.mobile, u.name AS counselor_name, u.email AS counselor_email
      FROM assignment_followups f
      JOIN assignment_leads al ON al.id = f.assignment_lead_id
      LEFT JOIN users u ON u.id = al.assigned_counselor_id
      WHERE f.status = 'Pending' AND f.scheduled_date < CURRENT_DATE AND f.alerted_at IS NULL
        AND u.email IS NOT NULL
    `);
    for (const f of missedAsgFollowups) {
      await sendEmail({
        to: f.counselor_email,
        subject: `Missed assignment follow-up: ${f.full_name} (${f.lead_code})`,
        html: `
          <p>Hi ${f.counselor_name || 'there'},</p>
          <p>An assignment-lead follow-up was due on <strong>${f.scheduled_date}</strong>${f.scheduled_time ? ` at ${f.scheduled_time}` : ''} and hasn't been marked complete yet.</p>
          <p><strong>Student:</strong> ${f.full_name} (${f.lead_code})<br/>
          <strong>Mobile:</strong> ${f.mobile}<br/>
          <strong>Type:</strong> ${f.followup_type}${f.notes ? `<br/><strong>Notes:</strong> ${f.notes}` : ''}</p>
          <p>Please follow up as soon as possible.</p>
          <p>— Degreeverse360 CRM</p>
        `,
      });
      await pool.query('UPDATE assignment_followups SET alerted_at = now() WHERE id = $1', [f.id]);
      sentCount++;
    }

    res.json({ checked: missedLeadFollowups.length + missedAsgFollowups.length, emailsSent: sentCount });
  } catch (err) { next(err); }
});

module.exports = router;
