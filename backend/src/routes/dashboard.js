const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ---------- GET /api/dashboard ----------
router.get('/', async (req, res, next) => {
  try {
    const vis = req.user.role === 'counselor' ? `AND l.assigned_counselor_id = ${req.user.id}` : '';

    const [
      totals, today, statusBreakdown, followupCounts, sourceBreakdown,
      courseBreakdown, universityBreakdown, counselorPerf,
    ] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) AS total_leads,
          COUNT(*) FILTER (WHERE ls.name = 'New') AS new_leads,
          COUNT(*) FILTER (WHERE ls.name = 'Interested') AS interested_leads,
          COUNT(*) FILTER (WHERE ls.is_won) AS enrollments,
          COUNT(*) FILTER (WHERE ls.is_lost) AS lost_leads,
          COUNT(*) FILTER (WHERE l.status_id IN (SELECT id FROM lead_statuses WHERE name LIKE 'Application%')) AS applications
        FROM leads l LEFT JOIN lead_statuses ls ON ls.id = l.status_id
        WHERE 1=1 ${vis}
      `),
      pool.query(`SELECT COUNT(*) AS todays_leads FROM leads l WHERE l.created_at::date = CURRENT_DATE ${vis}`),
      pool.query(`
        SELECT ls.name AS status, ls.color, COUNT(*) AS count
        FROM leads l JOIN lead_statuses ls ON ls.id = l.status_id
        WHERE 1=1 ${vis}
        GROUP BY ls.name, ls.color, ls.sort_order ORDER BY ls.sort_order
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE f.scheduled_date = CURRENT_DATE AND f.status='Pending') AS today,
          COUNT(*) FILTER (WHERE f.scheduled_date < CURRENT_DATE AND f.status='Pending') AS overdue
        FROM followups f JOIN leads l ON l.id = f.lead_id WHERE 1=1 ${vis}
      `),
      pool.query(`
        SELECT src.name AS source, COUNT(*) AS count FROM leads l
        LEFT JOIN lead_sources src ON src.id = l.source_id
        WHERE 1=1 ${vis} GROUP BY src.name ORDER BY count DESC
      `),
      pool.query(`
        SELECT c.name AS course, COUNT(*) AS count FROM leads l
        LEFT JOIN courses c ON c.id = l.interested_course_id
        WHERE l.interested_course_id IS NOT NULL ${vis} GROUP BY c.name ORDER BY count DESC LIMIT 10
      `),
      pool.query(`
        SELECT uni.name AS university, COUNT(*) AS count FROM leads l
        LEFT JOIN universities uni ON uni.id = l.interested_university_id
        WHERE l.interested_university_id IS NOT NULL ${vis} GROUP BY uni.name ORDER BY count DESC LIMIT 10
      `),
      pool.query(`
        SELECT u.id, u.name, u.avatar_color,
          COUNT(l.id) AS assigned_leads,
          COUNT(l.id) FILTER (WHERE ls.is_won) AS converted,
          COUNT(l.id) FILTER (WHERE ls.is_lost) AS lost,
          ROUND(100.0 * COUNT(l.id) FILTER (WHERE ls.is_won) / NULLIF(COUNT(l.id), 0), 1) AS conversion_rate
        FROM users u
        LEFT JOIN leads l ON l.assigned_counselor_id = u.id
        LEFT JOIN lead_statuses ls ON ls.id = l.status_id
        JOIN roles r ON r.id = u.role_id AND r.name = 'counselor'
        WHERE u.is_active = TRUE
        GROUP BY u.id, u.name, u.avatar_color ORDER BY converted DESC
      `),
    ]);

    const t = totals.rows[0];
    const conversionRate = t.total_leads > 0 ? ((t.enrollments / t.total_leads) * 100).toFixed(1) : '0.0';

    res.json({
      totalLeads: Number(t.total_leads),
      todaysLeads: Number(today.rows[0].todays_leads),
      newLeads: Number(t.new_leads),
      interestedLeads: Number(t.interested_leads),
      applications: Number(t.applications),
      enrollments: Number(t.enrollments),
      lostLeads: Number(t.lost_leads),
      conversionRate: Number(conversionRate),
      followupsToday: Number(followupCounts.rows[0].today),
      overdueFollowups: Number(followupCounts.rows[0].overdue),
      statusBreakdown: statusBreakdown.rows,
      sourceBreakdown: sourceBreakdown.rows,
      courseBreakdown: courseBreakdown.rows,
      universityBreakdown: universityBreakdown.rows,
      counselorPerformance: counselorPerf.rows,
    });
  } catch (err) { next(err); }
});

module.exports = router;
