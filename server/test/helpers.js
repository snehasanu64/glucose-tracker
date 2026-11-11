import request from 'supertest';
import { app } from '../src/index.js';
import { initDb, pool } from '../src/db.js';

let initialized = false;

export async function getTestApp() {
  if (!initialized) {
    await initDb();
    initialized = true;
  }
  return {
    request: request(app),
    pool
  };
}

export async function teardownTestApp() {
  if (initialized) {
    await pool.cleanupIsolatedTestSchema();
    await pool.end();
    initialized = false;
  }
}
