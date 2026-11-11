import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';
import {
  validateReading,
  SLOT_LABELS,
  SLOT_MAP,
  SLOT_ORDER_CASE,
  formatDuplicateSlotError,
  isValidCalendarDate
} from '../validation.js';

const router = Router();
router.use(requireAuth);

function parseReadingId(rawId) {
  if (!/^\d+$/.test(String(rawId))) return null;
  const id = Number(rawId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 100, date } = req.query;
    if (date !== undefined && !isValidCalendarDate(String(date))) {
      return res.status(400).json({ error: 'Please provide a valid date.' });
    }

    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(200, Math.max(1, Number(limit) || 100));
    const offset = (p - 1) * l;

    let query = 'SELECT id, reading_date::text AS date, slot, value, created_at FROM readings WHERE user_id = $1';
    const params = [req.user.id];

    if (date) {
      params.push(date);
      query += ` AND reading_date = $${params.length}`;
    }

    query += ` ORDER BY reading_date DESC, ${SLOT_ORDER_CASE} ASC, created_at ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(l, offset);

    const result = await pool.query(query, params);
    const readings = result.rows.map(r => ({
      ...r,
      slotLabel: SLOT_LABELS[r.slot] || r.slot
    }));
    res.json(readings);
  } catch (err) {
    console.error('Fetch readings error:', err);
    res.status(500).json({ error: 'Could not load readings.' });
  }
});

router.post('/', async (req, res) => {
  const error = validateReading(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  try {
    const { date, slot, value } = req.body;
    const normalizedSlot = SLOT_MAP[slot] || slot;
    const label = SLOT_LABELS[normalizedSlot] || normalizedSlot;

    const countRes = await pool.query(
      'SELECT COUNT(*)::int AS count FROM readings WHERE user_id = $1 AND reading_date = $2',
      [req.user.id, date]
    );
    if (countRes.rows[0].count >= 4) {
      return res.status(400).json({ error: 'You can add only 4 readings per day.' });
    }

    const dup = await pool.query(
      'SELECT id FROM readings WHERE user_id = $1 AND reading_date = $2 AND slot = $3',
      [req.user.id, date, normalizedSlot]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: formatDuplicateSlotError(normalizedSlot) });
    }

    const result = await pool.query(
      'INSERT INTO readings(user_id, reading_date, slot, value) VALUES($1, $2, $3, $4) RETURNING id, reading_date::text AS date, slot, value',
      [req.user.id, date, normalizedSlot, Number(value)]
    );

    res.status(201).json({
      ...result.rows[0],
      slotLabel: label
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: formatDuplicateSlotError(req.body.slot) });
    }
    console.error('Create reading error:', err);
    res.status(500).json({ error: 'Could not save reading.' });
  }
});

router.put('/:id', async (req, res) => {
  const readingId = parseReadingId(req.params.id);
  if (!readingId) {
    return res.status(400).json({ error: 'Invalid reading ID.' });
  }

  const error = validateReading(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  try {
    const { date, slot, value } = req.body;
    const normalizedSlot = SLOT_MAP[slot] || slot;
    const label = SLOT_LABELS[normalizedSlot] || normalizedSlot;

    const current = await pool.query(
      'SELECT id FROM readings WHERE id = $1 AND user_id = $2',
      [readingId, req.user.id]
    );
    if (!current.rowCount) {
      return res.status(404).json({ error: 'Reading not found.' });
    }

    const countRes = await pool.query(
      'SELECT COUNT(*)::int AS count FROM readings WHERE user_id = $1 AND reading_date = $2 AND id <> $3',
      [req.user.id, date, readingId]
    );
    if (countRes.rows[0].count >= 4) {
      return res.status(400).json({ error: 'You can add only 4 readings per day.' });
    }

    const dup = await pool.query(
      'SELECT id FROM readings WHERE user_id = $1 AND reading_date = $2 AND slot = $3 AND id <> $4',
      [req.user.id, date, normalizedSlot, readingId]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: formatDuplicateSlotError(normalizedSlot) });
    }

    const result = await pool.query(
      'UPDATE readings SET reading_date = $1, slot = $2, value = $3, updated_at = NOW() WHERE id = $4 AND user_id = $5 RETURNING id, reading_date::text AS date, slot, value',
      [date, normalizedSlot, Number(value), readingId, req.user.id]
    );

    res.json({
      ...result.rows[0],
      slotLabel: label
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: formatDuplicateSlotError(req.body.slot) });
    }
    console.error('Update reading error:', err);
    res.status(500).json({ error: 'Could not update reading.' });
  }
});

router.delete('/:id', async (req, res) => {
  const readingId = parseReadingId(req.params.id);
  if (!readingId) {
    return res.status(400).json({ error: 'Invalid reading ID.' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM readings WHERE id = $1 AND user_id = $2 RETURNING id',
      [readingId, req.user.id]
    );
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Reading not found.' });
    }
    res.json({ message: 'Reading deleted.' });
  } catch (err) {
    console.error('Delete reading error:', err);
    res.status(500).json({ error: 'Could not delete reading.' });
  }
});

export default router;
