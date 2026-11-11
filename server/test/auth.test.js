import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../src/auth.js';
import { getTestApp, teardownTestApp } from './helpers.js';

describe('User Authentication & Authorization Tests', () => {
  let req;
  let pool;

  before(async () => {
    const setup = await getTestApp();
    req = setup.request;
    pool = setup.pool;
  });

  after(async () => {
    await teardownTestApp();
  });

  it('registers a new user with name, email and password', async () => {
    const email = `test_reg_${Date.now()}@sweety.local`;
    const res = await req
      .post('/api/auth/register')
      .send({
        name: 'Jane Doe',
        email,
        password: 'SecurePassword123!'
      });

    assert.equal(res.status, 201);
    assert.ok(res.body.token, 'Should return JWT token');
    assert.ok(res.body.user, 'Should return user object');
    assert.equal(res.body.user.name, 'Jane Doe');
    assert.equal(res.body.user.email, email);
    assert.equal(res.body.user.password, undefined);
    assert.equal(res.body.user.password_hash, undefined);
  });

  it('rejects registration with duplicate email (409 Conflict)', async () => {
    const email = `test_dup_${Date.now()}@sweety.local`;
    await req
      .post('/api/auth/register')
      .send({
        name: 'Original User',
        email,
        password: 'Password123!'
      });

    const res = await req
      .post('/api/auth/register')
      .send({
        name: 'Imposter User',
        email,
        password: 'AnotherPassword456!'
      });

    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'An account with this email already exists.');
  });

  it('validates registration inputs (empty name, invalid email, short password)', async () => {
    const resShort = await req
      .post('/api/auth/register')
      .send({
        name: 'Test',
        email: 'test@sweety.local',
        password: 'short'
      });
    assert.equal(resShort.status, 400);
    assert.equal(resShort.body.error, 'Password must be at least 8 characters.');

    const resNoName = await req
      .post('/api/auth/register')
      .send({
        name: '   ',
        email: 'test@sweety.local',
        password: 'ValidPassword123!'
      });
    assert.equal(resNoName.status, 400);
    assert.equal(resNoName.body.error, 'Please enter your name.');

    const resBadEmail = await req
      .post('/api/auth/register')
      .send({
        name: 'Test',
        email: 'not-an-email',
        password: 'ValidPassword123!'
      });
    assert.equal(resBadEmail.status, 400);
    assert.equal(resBadEmail.body.error, 'Please enter a valid email address.');
  });

  it('hashes passwords using bcrypt and never stores plain-text passwords', async () => {
    const email = `test_bcrypt_${Date.now()}@sweety.local`;
    const plainPassword = 'TopSecretPassword2026!';
    await req
      .post('/api/auth/register')
      .send({
        name: 'Crypto User',
        email,
        password: plainPassword
      });

    const userRow = await pool.query('SELECT password_hash FROM users WHERE email = $1', [email]);
    assert.equal(userRow.rows.length, 1);
    const storedHash = userRow.rows[0].password_hash;

    assert.notEqual(storedHash, plainPassword, 'Database must never store plain-text password');
    assert.ok(storedHash.startsWith('$2'), 'Password hash must be a valid bcrypt hash');
    const matches = await bcrypt.compare(plainPassword, storedHash);
    assert.equal(matches, true, 'bcrypt.compare must verify the plain-text password against hash');
  });

  it('logs in successfully with valid email and password', async () => {
    const email = `test_login_${Date.now()}@sweety.local`;
    const password = 'MySecretLogin123!';
    await req
      .post('/api/auth/register')
      .send({
        name: 'Login Test',
        email,
        password
      });

    const res = await req
      .post('/api/auth/login')
      .send({ email, password });

    assert.equal(res.status, 200);
    assert.ok(res.body.token, 'Must return JWT token on login');
    assert.equal(res.body.user.email, email);
    assert.equal(res.body.user.name, 'Login Test');
  });

  it('rejects login with incorrect password (401)', async () => {
    const email = `test_wrong_${Date.now()}@sweety.local`;
    const password = 'CorrectPassword123!';
    await req
      .post('/api/auth/register')
      .send({ name: 'User', email, password });

    const res = await req
      .post('/api/auth/login')
      .send({ email, password: 'WrongPassword999!' });

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Invalid email or password.');
  });

  it('rejects login with non-existent email (401)', async () => {
    const res = await req
      .post('/api/auth/login')
      .send({
        email: 'ghost_user_does_not_exist@sweety.local',
        password: 'SomePassword123!'
      });

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Invalid email or password.');
  });

  it('protects private routes against unauthorized, invalid, and expired tokens', async () => {
    const resNoAuth = await req.get('/api/readings');
    assert.equal(resNoAuth.status, 401);
    assert.equal(resNoAuth.body.error, 'Please log in to continue.');

    const resReportNoAuth = await req.get('/api/reports/daily');
    assert.equal(resReportNoAuth.status, 401);

    const resBadToken = await req
      .get('/api/readings')
      .set('Authorization', 'Bearer bad.token.here');
    assert.equal(resBadToken.status, 401);
    assert.equal(resBadToken.body.error, 'Your session has expired. Please log in again.');

    const expiredToken = jwt.sign(
      { id: 999, email: 'expired@sweety.local', name: 'Expired' },
      getJwtSecret(),
      { expiresIn: '-10s' }
    );
    const resExpired = await req
      .get('/api/readings')
      .set('Authorization', `Bearer ${expiredToken}`);
    assert.equal(resExpired.status, 401);
    assert.equal(resExpired.body.error, 'Your session has expired. Please log in again.');
  });

  it('generates verifiable JWT tokens and allows access to protected routes', async () => {
    const email = `test_me_${Date.now()}@sweety.local`;
    const regRes = await req
      .post('/api/auth/register')
      .send({
        name: 'Protected User',
        email,
        password: 'ValidPassword123!'
      });
    const { token, user } = regRes.body;

    const decoded = jwt.verify(token, getJwtSecret());
    assert.equal(decoded.id, user.id);
    assert.equal(decoded.email, email);

    const meRes = await req
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.user.email, email);
    assert.equal(meRes.body.user.name, 'Protected User');
  });
});
