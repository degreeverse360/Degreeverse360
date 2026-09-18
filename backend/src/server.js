require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const leadRoutes = require('./routes/leads');
const followupRoutes = require('./routes/followups');
const dashboardRoutes = require('./routes/dashboard');
const settingsRoutes = require('./routes/settings');
const csvRoutes = require('./routes/csv');
const reportRoutes = require('./routes/reports');
const notificationRoutes = require('./routes/notifications');
const commissionRoutes = require('./routes/commissions');
const assignmentLeadRoutes = require('./routes/assignmentLeads');

const app = express();

// ---------- Security & core middleware ----------
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
}));
app.use(express.json({ limit: '2mb' }));

// Basic rate limiting to slow brute-force / abuse
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500 });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many login attempts. Please wait and try again.' } });
app.use('/api/', apiLimiter);
app.use('/api/auth/login', loginLimiter);

// ---------- Health check ----------
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'Degreeverse360 CRM API', time: new Date().toISOString() }));

// ---------- Routes ----------
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/followups', followupRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/csv', csvRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/commissions', commissionRoutes);
app.use('/api/assignment-leads', assignmentLeadRoutes);

// ---------- 404 ----------
app.use('/api/', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));

// ---------- Error handler (must be last) ----------
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Degreeverse360 CRM API running on port ${PORT}`);
});

module.exports = app;
