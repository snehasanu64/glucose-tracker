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
});

