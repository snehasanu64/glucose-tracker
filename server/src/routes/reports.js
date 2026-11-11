import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { SLOT_LABELS, SLOT_ORDER_CASE, getTodayString, isValidCalendarDate } from '../validation.js';

const router = Router();
router.use(requireAuth);

async function computeReport(req, res, start, end, includeReadings = false) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count,
            MAX(value)::int AS highest,
            MIN(value)::int AS lowest,
            ROUND(AVG(value), 1)::numeric AS average
     FROM readings
     WHERE user_id = $1 AND reading_date BETWEEN $2 AND $3`,
    [req.user.id, start, end]
  );

  const stats = result.rows[0] || { count: 0, highest: null, lowest: null, average: null };
  const count = Number(stats.count) || 0;
  const highest = count > 0 && stats.highest !== null ? Number(stats.highest) : null;
  const lowest = count > 0 && stats.lowest !== null ? Number(stats.lowest) : null;
  const average = count > 0 && stats.average !== null ? Number(Number(stats.average).toFixed(1)) : null;

  let readings = [];
  if (includeReadings) {
    const rows = await pool.query(
      `SELECT id, reading_date::text AS date, slot, value, created_at
       FROM readings
       WHERE user_id = $1 AND reading_date BETWEEN $2 AND $3
       ORDER BY ${SLOT_ORDER_CASE} ASC, created_at ASC`,
      [req.user.id, start, end]
    );
    readings = rows.rows.map(r => ({
      ...r,
      slotLabel: SLOT_LABELS[r.slot] || r.slot
    }));
  }

  res.json({
    startDate: start,
    endDate: end,
    count,
    highest,
    lowest,
    average,
    readings
  });
}

router.get('/daily', async (req, res) => {
  try {
    const d = req.query.date || getTodayString();
    if (!isValidCalendarDate(d)) {
      return res.status(400).json({ error: 'Please provide a valid date.' });
    }
    await computeReport(req, res, d, d, true);
  } catch (err) {
    console.error('Daily report error:', err);
    res.status(500).json({ error: 'Could not create report.' });
  }
});

router.get('/month-to-date', async (req, res) => {
  try {
    const d = req.query.date || getTodayString();
    if (!isValidCalendarDate(d)) {
      return res.status(400).json({ error: 'Please provide a valid date.' });
    }
    const start = `${d.slice(0, 7)}-01`;
    await computeReport(req, res, start, d, false);
  } catch (err) {
    console.error('Month-to-date report error:', err);
    res.status(500).json({ error: 'Could not create report.' });
  }
});

router.get('/previous-month', async (req, res) => {
  try {
    const d = req.query.date || getTodayString();
    if (!isValidCalendarDate(d)) {
      return res.status(400).json({ error: 'Please provide a valid date.' });
    }

    const [yearStr, monthStr] = d.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    let prevYear = year;
    let prevMonth = month - 1;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear -= 1;
    }

    const prevMonthFormatted = String(prevMonth).padStart(2, '0');
    const start = `${prevYear}-${prevMonthFormatted}-01`;
    const lastDayNumber = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
    const end = `${prevYear}-${prevMonthFormatted}-${String(lastDayNumber).padStart(2, '0')}`;

    await computeReport(req, res, start, end, false);
  } catch (err) {
    console.error('Previous-month report error:', err);
    res.status(500).json({ error: 'Could not create report.' });
  }
});

export default router;
