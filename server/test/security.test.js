import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp, getAllowedOrigins } from '../src/index.js';
import { getTestApp, teardownTestApp } from './helpers.js';

describe('Security Headers, Rate Limiting, CORS & Payload Limits', () => {
  let req;

  before(async () => {
    const setup = await getTestApp();
    req = setup.request;
  });

  after(async () => {
    await teardownTestApp();
  });

  it('sets Helmet security headers and hides X-Powered-By', async () => {
    const res = await req.get('/api/health');

    assert.equal(res.status, 200);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  it('rejects malformed JSON and oversized payloads without 500 errors', async () => {
    const badJsonRes = await req
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":"bad@sweety.local",');

    assert.equal(badJsonRes.status, 400);
    assert.equal(badJsonRes.body.error, 'Invalid JSON request body.');

    const oversizedPayload = {
      email: 'large@sweety.local',
      password: 'Password123!',
      padding: 'x'.repeat(24 * 1024)
    };
    const tooLargeRes = await req
      .post('/api/auth/login')
      .send(oversizedPayload);

    assert.equal(tooLargeRes.status, 413);
    assert.equal(tooLargeRes.body.error, 'Request payload is too large.');

    const regRes = await req
      .post('/api/auth/register')
      .send({
        name: 'Security Tester',
        email: `sec_payload_${Date.now()}@sweety.local`,
        password: 'ValidPassword123!'
      });
    assert.equal(regRes.status, 201);

    const noBodyReadingRes = await req
      .post('/api/readings')
      .set('Authorization', `Bearer ${regRes.body.token}`)
      .send('');
    assert.equal(noBodyReadingRes.status, 400);
  });

  it('restricts CORS origins strictly in production and supports comma-separated CLIENT_ORIGIN', async () => {
    assert.deepEqual(
      getAllowedOrigins({ nodeEnv: 'production', clientOrigin: '' }),
      []
    );
    assert.deepEqual(
      getAllowedOrigins({
        nodeEnv: 'production',
        clientOrigin: ' https://app.sweety.health , https://sweety.health '
      }),
      ['https://app.sweety.health', 'https://sweety.health']
    );

    const prodApp = createApp({
      nodeEnv: 'production',
      clientOrigin: 'https://app.sweety.health'
    });
    const prodReq = request(prodApp);

    const allowedRes = await prodReq
      .get('/api/health')
      .set('Origin', 'https://app.sweety.health');
    assert.equal(allowedRes.status, 200);
    assert.equal(allowedRes.headers['access-control-allow-origin'], 'https://app.sweety.health');
    assert.equal(allowedRes.headers['access-control-allow-credentials'], 'true');

    const blockedLocalhostRes = await prodReq
      .get('/api/health')
      .set('Origin', 'http://localhost:5173');
    assert.equal(blockedLocalhostRes.status, 200);
    assert.equal(blockedLocalhostRes.headers['access-control-allow-origin'], undefined);

    const blockedEvilRes = await prodReq
      .get('/api/health')
      .set('Origin', 'https://evil.example.com');
    assert.equal(blockedEvilRes.headers['access-control-allow-origin'], undefined);
  });

  it('enforces rate limiting on /api/auth/login and /api/auth/register', async () => {
    // Verify the default app router enforces the 15-request limit per endpoint
    let loginLimitedRes = null;
    for (let i = 0; i < 16; i += 1) {
      const res = await req
        .post('/api/auth/login')
        .send({ email: `ratelimit_ghost_${i}@sweety.local`, password: 'SomePassword123!' });
      if (i === 0) {
        assert.ok(res.headers.ratelimit || res.headers['ratelimit-policy'], 'Login route should return RateLimit header');
      }
      if (res.status === 429) {
        loginLimitedRes = res;
        break;
      }
    }
    assert.ok(loginLimitedRes, 'Expected login endpoint to return HTTP 429 after exceeding limit');
    assert.equal(loginLimitedRes.status, 429);
    assert.equal(loginLimitedRes.body.error, 'Too many login attempts. Please try again later.');

    let registerLimitedRes = null;
    for (let i = 0; i < 16; i += 1) {
      const res = await req
        .post('/api/auth/register')
        .send({ name: '', email: 'invalid', password: 'short' });
      if (res.status === 429) {
        registerLimitedRes = res;
        break;
      }
    }
    assert.ok(registerLimitedRes, 'Expected register endpoint to return HTTP 429 after exceeding limit');
    assert.equal(registerLimitedRes.status, 429);
    assert.equal(registerLimitedRes.body.error, 'Too many registration attempts. Please try again later.');
  });
});
