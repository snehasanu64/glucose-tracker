import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { getTestApp } from './helpers.js';
import { runSeed } from '../src/seed.js';

describe('Database Schema, Constraints, Cascade & Seed Tests', () => {
  let pool;

  before(async () => {
    const setup = await getTestApp();
    pool = setup.pool;
  });

  it('creates users and readings tables and user-date index', async () => {
    const tables = await pool.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename IN ('users', 'readings')
      ORDER BY tablename
    `);
    assert.deepEqual(
      tables.rows.map((r) => r.tablename),
      ['readings', 'users']
    );

    const indexes = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'readings_user_date_idx'
    `);
    assert.equal(indexes.rows.length, 1);
  });

  it('enforces CHECK constraints on value (40-600) and slot at database level', async () => {
    const userRes = await pool.query(
      'INSERT INTO users(name, email, password_hash) VALUES($1, $2, $3) RETURNING id',
      ['Constraint Tester', `constraint_${Date.now()}@sweety.local`, 'hash']
    );
    const userId = userRes.rows[0].id;

    await assert.rejects(
      () =>
        pool.query(
          'INSERT INTO readings(user_id, reading_date, slot, value) VALUES($1, $2, $3, $4)',
          [userId, '2026-10-10', 'morning', 30]
        ),
      (err) => err.code === '23514' // check_violation
    );

    await assert.rejects(
      () =>
        pool.query(
          'INSERT INTO readings(user_id, reading_date, slot, value) VALUES($1, $2, $3, $4)',
          [userId, '2026-10-10', 'morning', 700]
        ),
      (err) => err.code === '23514'
    );

    await assert.rejects(
      () =>
        pool.query(
          'INSERT INTO readings(user_id, reading_date, slot, value) VALUES($1, $2, $3, $4)',
          [userId, '2026-10-10', 'invalid_slot', 100]
        ),
      (err) => err.code === '23514'
    );
  });

  it('enforces UNIQUE(user_id, reading_date, slot) and ON DELETE CASCADE', async () => {
    const userRes = await pool.query(
      'INSERT INTO users(name, email, password_hash) VALUES($1, $2, $3) RETURNING id',
      ['Cascade Tester', `cascade_${Date.now()}@sweety.local`, 'hash']
    );
    const userId = userRes.rows[0].id;

    await pool.query(
      'INSERT INTO readings(user_id, reading_date, slot, value) VALUES($1, $2, $3, $4)',
      [userId, '2026-10-15', 'morning', 110]
    );

    // Duplicate slot at DB level must raise 23505 unique_violation
    await assert.rejects(
      () =>
        pool.query(
          'INSERT INTO readings(user_id, reading_date, slot, value) VALUES($1, $2, $3, $4)',
          [userId, '2026-10-15', 'morning', 115]
        ),
      (err) => err.code === '23505'
    );

    // Deleting user must cascade delete readings
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    const remaining = await pool.query('SELECT id FROM readings WHERE user_id = $1', [userId]);
    assert.equal(remaining.rows.length, 0);
  });

  it('runs seed script cleanly and creates demo user and sample readings', async () => {
    await runSeed();

    const demoUser = await pool.query('SELECT id, name, email FROM users WHERE email = $1', [
      'demo@sweety.local'
    ]);
    assert.equal(demoUser.rows.length, 1);
    assert.equal(demoUser.rows[0].name, 'Demo User');

    const demoReadings = await pool.query('SELECT COUNT(*)::int AS count FROM readings WHERE user_id = $1', [
      demoUser.rows[0].id
    ]);
    assert.ok(demoReadings.rows[0].count >= 20, 'Seed should insert current and previous month readings');
  });
});

