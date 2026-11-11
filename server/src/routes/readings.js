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

async function checkDailyQuotaAndSlot(tx, { userId, date, normalizedSlot, excludeReadingId = null }) {
  const countSql = excludeReadingId === null
    ? 'SELECT COUNT(*)::int AS count FROM readings WHERE user_id = $1 AND reading_date = $2'
    : 'SELECT COUNT(*)::int AS count FROM readings WHERE user_id = $1 AND reading_date = $2 AND id <> $3';
  const countParams = excludeReadingId === null
    ? [userId, date]
    : [userId, date, excludeReadingId];

  const countRes = await tx.query(countSql, countParams);
  if (countRes.rows[0].count >= 4) {
    return { status: 400, payload: { error: 'You can add only 4 readings per day.' } };
  }

  const dupSql = excludeReadingId === null
    ? 'SELECT id FROM readings WHERE user_id = $1 AND reading_date = $2 AND slot = $3'
    : 'SELECT id FROM readings WHERE user_id = $1 AND reading_date = $2 AND slot = $3 AND id <> $4';
  const dupParams = excludeReadingId === null
    ? [userId, date, normalizedSlot]
    : [userId, date, normalizedSlot, excludeReadingId];

  const dup = await tx.query(dupSql, dupParams);
  if (dup.rows.length > 0) {
    return { status: 409, payload: { error: formatDuplicateSlotError(normalizedSlot) } };
  }

  return null;
}

router.post('/', async (req, res) => {
  const error = validateReading(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  const { date, slot, value } = req.body;
  const normalizedSlot = SLOT_MAP[slot] || slot;
  const label = SLOT_LABELS[normalizedSlot] || normalizedSlot;

  try {
    const outcome = await pool.withTransaction(async (tx) => {
      // Lock the parent user row so concurrent inserts/updates for this user serialize safely.
      const userLock = await tx.query(
        'SELECT id FROM users WHERE id = $1 FOR UPDATE',
        [req.user.id]
      );
      if (!userLock.rowCount) {
        return { status: 401, payload: { error: 'Account not found. Please log in again.' } };
      }

      const violation = await checkDailyQuotaAndSlot(tx, {
        userId: req.user.id,
        date,
        normalizedSlot
      });
      if (violation) {
        return violation;
      }

      const result = await tx.query(
        'INSERT INTO readings(user_id, reading_date, slot, value) VALUES($1, $2, $3, $4) RETURNING id, reading_date::text AS date, slot, value',
        [req.user.id, date, normalizedSlot, Number(value)]
      );

      return {
        status: 201,
        payload: {
          ...result.rows[0],
          slotLabel: label
        }
      };
    });

    res.status(outcome.status).json(outcome.payload);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: formatDuplicateSlotError(normalizedSlot) });
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

  const { date, slot, value } = req.body;
  const normalizedSlot = SLOT_MAP[slot] || slot;
  const label = SLOT_LABELS[normalizedSlot] || normalizedSlot;

  try {
    const outcome = await pool.withTransaction(async (tx) => {
      // Lock in consistent hierarchy order (users -> readings) to match POST and prevent deadlocks.
      const userLock = await tx.query(
        'SELECT id FROM users WHERE id = $1 FOR UPDATE',
        [req.user.id]
      );
      if (!userLock.rowCount) {
        return { status: 401, payload: { error: 'Account not found. Please log in again.' } };
      }

      const current = await tx.query(
        'SELECT id FROM readings WHERE id = $1 AND user_id = $2',
        [readingId, req.user.id]
      );
      if (!current.rowCount) {
        return { status: 404, payload: { error: 'Reading not found.' } };
      }

      const violation = await checkDailyQuotaAndSlot(tx, {
        userId: req.user.id,
        date,
        normalizedSlot,
        excludeReadingId: readingId
      });
      if (violation) {
        return violation;
      }

      const result = await tx.query(
        'UPDATE readings SET reading_date = $1, slot = $2, value = $3, updated_at = NOW() WHERE id = $4 AND user_id = $5 RETURNING id, reading_date::text AS date, slot, value',
        [date, normalizedSlot, Number(value), readingId, req.user.id]
      );

      return {
        status: 200,
        payload: {
          ...result.rows[0],
          slotLabel: label
        }
      };
    });

    res.status(outcome.status).json(outcome.payload);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: formatDuplicateSlotError(normalizedSlot) });
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
