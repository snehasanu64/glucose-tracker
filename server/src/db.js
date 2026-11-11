import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

const { Pool: PgPool } = pg;

class DbClient {
  constructor() {
    this.mode = 'uninitialized';
    this.pgPool = null;
    this.pgliteInstance = null;
  }

  async init() {
    if (this.mode !== 'uninitialized') return;

    const connectionString = process.env.DATABASE_URL;
    let connectedToPostgres = false;

    if (connectionString && !process.env.FORCE_EMBEDDED_DB) {
      const testPool = new PgPool({
        connectionString,
        connectionTimeoutMillis: 2000
      });
      try {
        await testPool.query('SELECT 1');
        this.pgPool = testPool;
        this.mode = 'postgres';
        connectedToPostgres = true;
        console.log('Connected to PostgreSQL server successfully.');
      } catch (err) {
        await testPool.end().catch(() => {});
        console.warn('Could not connect to external PostgreSQL server configured in DATABASE_URL:', err.message);
        console.warn('Falling back to local embedded PostgreSQL engine (PGlite)...');
      }
    }

    if (!connectedToPostgres) {
      const isTestMode =
        process.env.NODE_ENV === 'test' ||
        process.execArgv.some(arg => arg.includes('--test')) ||
        process.argv.some(arg => arg.includes('--test') || arg.includes('.test.'));

      const dataDir = isTestMode
        ? undefined
        : path.resolve(process.cwd(), 'data', 'pgdata');

      if (dataDir && !fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      this.pgliteInstance = new PGlite(dataDir);
      this.mode = 'pglite';
      console.log(`Using embedded PostgreSQL engine (${dataDir ? 'persisted at ' + dataDir : 'in-memory'}).`);
    }

    await this.applySchema();
  }

  async applySchema() {
    const ddl = `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS readings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reading_date DATE NOT NULL,
        slot VARCHAR(30) NOT NULL CHECK (slot IN ('morning','after_breakfast','after_lunch','after_dinner')),
        value INTEGER NOT NULL CHECK (value BETWEEN 40 AND 600),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, reading_date, slot)
      );
      CREATE INDEX IF NOT EXISTS readings_user_date_idx ON readings(user_id, reading_date);
    `;

    if (this.mode === 'postgres') {
      await this.pgPool.query(ddl);
    } else {
      await this.pgliteInstance.exec(ddl);
    }
  }

  async query(text, params = []) {
    if (this.mode === 'uninitialized') {
      await this.init();
    }

    if (this.mode === 'postgres') {
      const res = await this.pgPool.query(text, params);
      return {
        rows: res.rows,
        rowCount: res.rowCount
      };
    } else {
      const res = await this.pgliteInstance.query(text, params);
      return {
        rows: res.rows,
        rowCount: res.rowCount !== undefined ? res.rowCount : (res.affectedRows ?? res.rows.length)
      };
    }
  }

  getMode() {
    return this.mode;
  }

  async end() {
    if (this.pgPool) {
      await this.pgPool.end();
    }
    if (this.pgliteInstance) {
      await this.pgliteInstance.close?.();
    }
    this.mode = 'uninitialized';
  }
}

export const pool = new DbClient();

export async function initDb() {
  await pool.init();
}
