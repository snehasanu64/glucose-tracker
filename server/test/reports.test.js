import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { getTestApp } from './helpers.js';
import { getTodayString } from '../src/validation.js';

describe('Reports API Tests', () => {
  let req;
  let pool;
  let token;
  let otherToken;
  const today = getTodayString();

  before(async () => {
    const setup = await getTestApp();
    req = setup.request;
    pool = setup.pool;

    const resUser = await req
      .post('/api/auth/register')
      .send({
        name: 'Report Test User',
        email: `report_${Date.now()}@sweety.local`,
        password: 'Password123!'
      });
    token = resUser.body.token;

    const resOther = await req
      .post('/api/auth/register')
      .send({
        name: 'Other User',
        email: `other_report_${Date.now()}@sweety.local`,
        password: 'Password123!'
      });
    otherToken = resOther.body.token;

    // Add deterministic readings for report user:
    // Today:
    // morning: 100
    // after_breakfast: 145
    // after_lunch: 130
    // Highest: 145, Lowest: 100, Average: (100+145+130)/3 = 375/3 = 125.0
    await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${token}`)
      .send({ date: today, slot: 'morning', value: 100 });
    await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${token}`)
      .send({ date: today, slot: 'after_breakfast', value: 145 });
    await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${token}`)
      .send({ date: today, slot: 'after_lunch', value: 130 });

    // Other user adds reading on same date (to verify isolation)
    await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ date: today, slot: 'morning', value: 350 });
  });

  it('calculates daily report correctly with statistics and readings list', async () => {
    const res = await req
      .get(`/api/reports/daily?date=${today}`)
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.count, 3);
    assert.equal(res.body.highest, 145);
    assert.equal(res.body.lowest, 100);
    assert.equal(res.body.average, 125);
    assert.equal(res.body.readings.length, 3);
    assert.ok(res.body.readings.every(r => r.slotLabel), 'Every reading must include slotLabel');
  });

  it('returns friendly empty state for daily report when no readings exist', async () => {
    const d = new Date();
    d.setDate(d.getDate() - 25);
    const emptyDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const res = await req
      .get(`/api/reports/daily?date=${emptyDate}`)
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.count, 0);
    assert.equal(res.body.highest, null);
    assert.equal(res.body.lowest, null);
    assert.equal(res.body.average, null);
    assert.deepEqual(res.body.readings, []);
  });

  it('calculates month-to-date report from 1st of month to selected date', async () => {
    const res = await req
      .get(`/api/reports/month-to-date?date=${today}`)
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.startDate, `${today.slice(0, 7)}-01`);
    assert.equal(res.body.endDate, today);
    assert.ok(res.body.count >= 3);
    assert.equal(res.body.highest, 145);
    assert.equal(res.body.lowest, 100);
  });

  it('calculates previous-month report for entire previous calendar month', async () => {
    // Add a reading in previous month
    const now = new Date();
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 10);
    const prevMonthYear = prevMonthDate.getFullYear();
    const prevMonthNum = prevMonthDate.getMonth() + 1;
    const prevDateStr = `${prevMonthYear}-${String(prevMonthNum).padStart(2, '0')}-10`;

    await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${token}`)
      .send({ date: prevDateStr, slot: 'morning', value: 110 });

    const res = await req
      .get(`/api/reports/previous-month?date=${today}`)
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.ok(res.body.count >= 1);
    assert.equal(res.body.highest, 110);
    assert.equal(res.body.lowest, 110);
    assert.equal(res.body.average, 110);
  });

  it('enforces user isolation in reports', async () => {
    const res = await req
      .get(`/api/reports/daily?date=${today}`)
      .set('Authorization', `Bearer ${otherToken}`);

    assert.equal(res.status, 200);
    // Other user only added 1 reading with value 350
    assert.equal(res.body.count, 1);
    assert.equal(res.body.highest, 350);
    assert.equal(res.body.lowest, 350);
    assert.equal(res.body.average, 350);
  });

  it('rounds average to one decimal place accurately', async () => {
    // 100, 101, 101 -> sum 302 -> 302/3 = 100.6666... -> 100.7
    const testDate = '2025-05-15';
    await req.post('/api/readings').set('Authorization', `Bearer ${token}`).send({ date: testDate, slot: 'morning', value: 100 });
    await req.post('/api/readings').set('Authorization', `Bearer ${token}`).send({ date: testDate, slot: 'after_breakfast', value: 101 });
    await req.post('/api/readings').set('Authorization', `Bearer ${token}`).send({ date: testDate, slot: 'after_lunch', value: 101 });

    const res = await req
      .get(`/api/reports/daily?date=${testDate}`)
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.count, 3);
    assert.equal(res.body.average, 100.7);
    assert.deepEqual(
      res.body.readings.map(r => r.slot),
      ['morning', 'after_breakfast', 'after_lunch']
    );
  });

  it('handles month boundaries, leap years, and year transitions correctly', async () => {
    // Year boundary: January 2026 -> previous month must be Dec 1 - Dec 31, 2025
    await req.post('/api/readings').set('Authorization', `Bearer ${token}`).send({ date: '2025-12-01', slot: 'morning', value: 95 });
    await req.post('/api/readings').set('Authorization', `Bearer ${token}`).send({ date: '2025-12-31', slot: 'after_dinner', value: 135 });

    const janRes = await req
      .get('/api/reports/previous-month?date=2026-01-10')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(janRes.status, 200);
    assert.equal(janRes.body.startDate, '2025-12-01');
    assert.equal(janRes.body.endDate, '2025-12-31');
    assert.equal(janRes.body.count, 2);
    assert.equal(janRes.body.highest, 135);
    assert.equal(janRes.body.lowest, 95);
    assert.equal(janRes.body.average, 115);

    // Leap year February: March 2024 -> previous month must be Feb 1 - Feb 29, 2024
    await req.post('/api/readings').set('Authorization', `Bearer ${token}`).send({ date: '2024-02-29', slot: 'morning', value: 104 });
    const leapRes = await req
      .get('/api/reports/previous-month?date=2024-03-10')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(leapRes.status, 200);
    assert.equal(leapRes.body.startDate, '2024-02-01');
    assert.equal(leapRes.body.endDate, '2024-02-29');
    assert.equal(leapRes.body.count, 1);

    // Non-leap year February: March 2025 -> previous month must be Feb 1 - Feb 28, 2025
    const nonLeapRes = await req
      .get('/api/reports/previous-month?date=2025-03-10')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(nonLeapRes.status, 200);
    assert.equal(nonLeapRes.body.startDate, '2025-02-01');
    assert.equal(nonLeapRes.body.endDate, '2025-02-28');
    assert.equal(nonLeapRes.body.count, 0);
    assert.equal(nonLeapRes.body.average, null);

    // Month-to-date on 1st of month -> startDate === endDate
    const firstDayRes = await req
      .get('/api/reports/month-to-date?date=2025-12-01')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(firstDayRes.status, 200);
    assert.equal(firstDayRes.body.startDate, '2025-12-01');
    assert.equal(firstDayRes.body.endDate, '2025-12-01');
    assert.equal(firstDayRes.body.count, 1);
  });
});

