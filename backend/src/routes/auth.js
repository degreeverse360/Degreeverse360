const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../utils/logging');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------- POST /api/auth/login ----------
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) throw new AppError('Email and password are required.');

    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.password_hash, u.is_active, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.email = $1`,
      [email.toLowerCase().trim()]
    );

    const user = rows[0];
    if (!user) {
      await logAudit({ entityType: 'auth', action: 'login_failed', details: { email }, ip: req.ip });
      throw new AppError('Invalid email or password.', 401);
    }
    if (!user.is_active) {
      throw new AppError('This account has been deactivated. Contact your administrator.', 403);
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      await logAudit({ userId: user.id, entityType: 'auth', action: 'login_failed', ip: req.ip });
      throw new AppError('Invalid email or password.', 401);
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    await logAudit({ userId: user.id, entityType: 'auth', action: 'login', ip: req.ip });

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/auth/me ----------
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.mobile, r.name AS role, u.avatar_color
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [req.user.id]
    );
    if (!rows[0]) throw new AppError('User not found.', 404);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/auth/change-password ----------
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) throw new AppError('Both current and new password are required.');
    if (newPassword.length < 8) throw new AppError('New password must be at least 8 characters.');

    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) throw new AppError('Current password is incorrect.', 401);

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    await logAudit({ userId: req.user.id, entityType: 'auth', action: 'password_changed', ip: req.ip });

    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
