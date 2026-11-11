import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { getJwtSecret, requireAuth } from '../auth.js';

function parsePositiveInt(value, fallback) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : fallback;
}

function createAuthRateLimiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: message }
  });
}

export function createAuthRouter({
  windowMs = parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  loginLimit = parsePositiveInt(process.env.LOGIN_RATE_LIMIT_MAX, 15),
  registerLimit = parsePositiveInt(process.env.REGISTER_RATE_LIMIT_MAX, 15)
} = {}) {
  const router = Router();

  const registerLimiter = createAuthRateLimiter({
    windowMs,
    limit: registerLimit,
    message: 'Too many registration attempts. Please try again later.'
  });

  const loginLimiter = createAuthRateLimiter({
    windowMs,
    limit: loginLimit,
    message: 'Too many login attempts. Please try again later.'
  });

  router.post('/register', registerLimiter, async (req, res) => {
    try {
      const { name, email, password } =
        req.body && typeof req.body === 'object' ? req.body : {};
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Please enter your name.' });
      }
      if (!email || typeof email !== 'string' || !email.trim()) {
        return res.status(400).json({ error: 'Please enter an email address.' });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }
      if (!password || typeof password !== 'string') {
        return res.status(400).json({ error: 'Please enter a password.' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }

      const hash = await bcrypt.hash(password, 12);
      const result = await pool.query(
        'INSERT INTO users(name, email, password_hash) VALUES($1, $2, $3) RETURNING id, name, email',
        [name.trim(), email.trim().toLowerCase(), hash]
      );

      const user = result.rows[0];
      const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, getJwtSecret(), { expiresIn: '7d' });
      res.status(201).json({ user, token });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      console.error('Registration error:', err);
      res.status(500).json({ error: 'Could not create your account.' });
    }
  });

  router.post('/login', loginLimiter, async (req, res) => {
    try {
      const { email, password } =
        req.body && typeof req.body === 'object' ? req.body : {};
      if (!email || typeof email !== 'string' || !email.trim()) {
        return res.status(400).json({ error: 'Please enter your email address.' });
      }
      if (!password || typeof password !== 'string') {
        return res.status(400).json({ error: 'Please enter your password.' });
      }

      const result = await pool.query(
        'SELECT id, name, email, password_hash FROM users WHERE email = $1',
        [email.trim().toLowerCase()]
      );
      const user = result.rows[0];

      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, getJwtSecret(), { expiresIn: '7d' });
      res.json({
        user: { id: user.id, name: user.name, email: user.email },
        token
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Could not log in.' });
    }
  });

  router.get('/me', requireAuth, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, name, email, created_at FROM users WHERE id = $1',
        [req.user.id]
      );
      if (!result.rows.length) {
        return res.status(404).json({ error: 'User not found.' });
      }
      res.json({ user: result.rows[0] });
    } catch (err) {
      console.error('Get profile error:', err);
      res.status(500).json({ error: 'Could not fetch user profile.' });
    }
  });

  return router;
}

export default createAuthRouter();
