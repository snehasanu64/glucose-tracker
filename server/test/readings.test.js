import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { getTestApp } from './helpers.js';
import { getTodayString } from '../src/validation.js';

describe('Glucose Readings API Tests', () => {
  let req;
  let pool;
  let tokenUserA;
  let userAId;
  let tokenUserB;
  let userBId;
  const today = getTodayString();

  before(async () => {
    const setup = await getTestApp();
    req = setup.request;
    pool = setup.pool;

    // Create User A
    const resA = await req
      .post('/api/auth/register')
      .send({
        name: 'User Alpha',
        email: `alpha_${Date.now()}@sweety.local`,
        password: 'PasswordAlpha123!'
      });
    tokenUserA = resA.body.token;
    userAId = resA.body.user.id;

    // Create User B
    const resB = await req
      .post('/api/auth/register')
      .send({
        name: 'User Beta',
        email: `beta_${Date.now()}@sweety.local`,
        password: 'PasswordBeta123!'
      });
    tokenUserB = resB.body.token;
    userBId = resB.body.user.id;
  });

  it('successfully creates a valid glucose reading', async () => {
    const res = await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${tokenUserA}`)
      .send({
        date: today,
        slot: 'morning',
        value: 105
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.date, today);
    assert.equal(res.body.slot, 'morning');
    assert.equal(res.body.slotLabel, 'Morning (fasting)');
    assert.equal(res.body.value, 105);
    assert.ok(res.body.id, 'Reading ID should be present');
  });

  it('rejects adding a reading without a glucose value', async () => {
    const res = await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${tokenUserA}`)
      .send({
        date: today,
        slot: 'after_breakfast',
        value: ''
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Please enter a glucose value.');
  });

  it('rejects glucose values outside 40 and 600 mg/dl', async () => {
    const resTooLow = await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${tokenUserA}`)
      .send({
        date: today,
        slot: 'after_breakfast',
        value: 35
      });
    assert.equal(resTooLow.status, 400);
    assert.equal(resTooLow.body.error, 'Value must be between 40 and 600 mg/dl.');

    const resTooHigh = await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${tokenUserA}`)
      .send({
        date: today,
        slot: 'after_breakfast',
        value: 650
      });
    assert.equal(resTooHigh.status, 400);
    assert.equal(resTooHigh.body.error, 'Value must be between 40 and 600 mg/dl.');
  });

  it('rejects future dates', async () => {
    const futureDateObj = new Date();
    futureDateObj.setDate(futureDateObj.getDate() + 2);
    const futureStr = `${futureDateObj.getFullYear()}-${String(futureDateObj.getMonth() + 1).padStart(2, '0')}-${String(futureDateObj.getDate()).padStart(2, '0')}`;

    const res = await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${tokenUserA}`)
      .send({
        date: futureStr,
        slot: 'after_breakfast',
        value: 120
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Date cannot be in the future.');
  });

  it('rejects non-integer glucose values, invalid dates, and invalid time slots', async () => {
    const resDecimal = await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${tokenUserA}`)
      .send({ date: today, slot: 'after_breakfast', value: 120.5 });
    assert.equal(resDecimal.status, 400);
    assert.equal(resDecimal.body.error, 'Value must be between 40 and 600 mg/dl.');

    const resInvalidDate = await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${tokenUserA}`)
      .send({ date: '2026-02-30', slot: 'after_breakfast', value: 120 });
    assert.equal(resInvalidDate.status, 400);
    assert.equal(resInvalidDate.body.error, 'Please enter a valid date.');

    const resInvalidSlot = await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${tokenUserA}`)
      .send({ date: today, slot: 'midnight_snack', value: 120 });
    assert.equal(resInvalidSlot.status, 400);
    assert.equal(resInvalidSlot.body.error, 'Please select a valid time slot.');
  });

  it('rejects duplicate reading for the same time slot on the same day', async () => {
    // We already added 'morning' on 'today' for User A in test 1
    const res = await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${tokenUserA}`)
      .send({
        date: today,
        slot: 'morning',
        value: 115
      });

    assert.equal(res.status, 409);
    assert.match(res.body.error, /You already have a(n)? Morning \(fasting\) reading for this date\./);
  });

  it('enforces maximum of 4 readings per day and chronological ordering', async () => {
    // User A currently has 1 reading ('morning') on today
    // Add slot 4 ('after_dinner'), slot 3 ('after_lunch'), slot 2 ('after_breakfast') out of order
    const r4 = await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${tokenUserA}`)
      .send({ date: today, slot: 'after_dinner', value: 125 });
    assert.equal(r4.status, 201);

    const r3 = await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${tokenUserA}`)
      .send({ date: today, slot: 'after_lunch', value: 135 });
    assert.equal(r3.status, 201);

    const r2 = await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${tokenUserA}`)
      .send({ date: today, slot: 'after_breakfast', value: 140 });
    assert.equal(r2.status, 201);

    // Verify chronological ordering in GET /api/readings
    const listRes = await req
      .get(`/api/readings?date=${today}`)
      .set('Authorization', `Bearer ${tokenUserA}`);
    assert.equal(listRes.status, 200);
    assert.deepEqual(
      listRes.body.map(r => r.slot),
      ['morning', 'after_breakfast', 'after_lunch', 'after_dinner']
    );

    // Try to add a 5th reading on the same day (must return exact max-4 error)
    const r5 = await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${tokenUserA}`)
      .send({ date: today, slot: 'morning', value: 110 });

    assert.equal(r5.status, 400);
    assert.equal(r5.body.error, 'You can add only 4 readings per day.');
  });

  it('edits an existing reading on a full 4-reading day without triggering max or duplicate errors', async () => {
    const listRes = await req
      .get(`/api/readings?date=${today}`)
      .set('Authorization', `Bearer ${tokenUserA}`);
    assert.equal(listRes.body.length, 4);
    const reading = listRes.body[0];

    const editRes = await req
      .put(`/api/readings/${reading.id}`)
      .set('Authorization', `Bearer ${tokenUserA}`)
      .send({
        date: reading.date,
        slot: reading.slot,
        value: 155
      });

    assert.equal(editRes.status, 200);
    assert.equal(editRes.body.value, 155);
    assert.equal(editRes.body.id, reading.id);

    // Invalid ID check
    const badIdRes = await req
      .put('/api/readings/not-a-number')
      .set('Authorization', `Bearer ${tokenUserA}`)
      .send({ date: today, slot: 'morning', value: 110 });
    assert.equal(badIdRes.status, 400);
  });

  it('deletes an existing reading', async () => {
    // Add a throwaway reading on a past date
    const d = new Date();
    d.setDate(d.getDate() - 5);
    const pastDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const addRes = await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${tokenUserA}`)
      .send({ date: pastDate, slot: 'morning', value: 98 });
    const readingId = addRes.body.id;

    // Delete reading
    const delRes = await req
      .delete(`/api/readings/${readingId}`)
      .set('Authorization', `Bearer ${tokenUserA}`);
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.message, 'Reading deleted.');

    // Deleting again should return 404
    const delAgainRes = await req
      .delete(`/api/readings/${readingId}`)
      .set('Authorization', `Bearer ${tokenUserA}`);
    assert.equal(delAgainRes.status, 404);
  });

  it('enforces strict user data isolation', async () => {
    // User A creates a reading
    const d = new Date();
    d.setDate(d.getDate() - 10);
    const pastDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const resA = await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${tokenUserA}`)
      .send({ date: pastDate, slot: 'morning', value: 112 });
    const readingIdA = resA.body.id;

    // User B lists readings - must NOT see User A's reading
    const listB = await req
      .get('/api/readings')
      .set('Authorization', `Bearer ${tokenUserB}`);
    const foundInB = listB.body.some(r => r.id === readingIdA);
    assert.equal(foundInB, false, 'User B must not see User A reading');

    // User B tries to edit User A's reading - must return 404
    const editB = await req
      .put(`/api/readings/${readingIdA}`)
      .set('Authorization', `Bearer ${tokenUserB}`)
      .send({ date: pastDate, slot: 'morning', value: 180 });
    assert.equal(editB.status, 404, 'User B must not be able to edit User A reading');

    // User B tries to delete User A's reading - must return 404
    const deleteB = await req
      .delete(`/api/readings/${readingIdA}`)
      .set('Authorization', `Bearer ${tokenUserB}`);
    assert.equal(deleteB.status, 404, 'User B must not be able to delete User A reading');
  });
});

