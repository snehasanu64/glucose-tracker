import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverEnvPath = path.resolve(__dirname, '../.env');

dotenv.config({ path: serverEnvPath });

const { Pool: PgPool } = pg;

function assertSafeIdentifier(name, label = 'schema') {
  if (!name || !/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`Invalid PostgreSQL ${label} name.`);
  }
  return name;
}

function sanitizeConnectionError(err, connectionString) {
  let msg = err?.message ? String(err.message) : 'Unknown database connection error.';
  if (connectionString) {
    msg = msg.split(connectionString).join('[REDACTED_DATABASE_URL]');
  }
  msg = msg.replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi, 'postgresql://***:***@');
  return msg;
}

function buildPgPoolConfig(connectionString, { isTestMode = false } = {}) {
  let parsedUrl;
  try {
    parsedUrl = new URL(connectionString);
  } catch {
    throw new Error(
      'Invalid DATABASE_URL format. Check host, port, and URL-encode any special characters in your password.'
    );
  }

  const host = parsedUrl.hostname.toLowerCase();
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const sslParam = parsedUrl.searchParams.get('sslmode')?.toLowerCase();
  const envSsl = process.env.DATABASE_SSL?.trim().toLowerCase();

  let useSsl;
  if (envSsl === 'false' || envSsl === '0' || sslParam === 'disable') {
    useSsl = false;
  } else if (envSsl === 'true' || envSsl === '1' || sslParam || !isLocalHost) {
    useSsl = true;
  } else {
    useSsl = false;
  }

  // Strip URL SSL query parameters so pg-connection-string does not override explicit ssl options.
  parsedUrl.searchParams.delete('sslmode');
  parsedUrl.searchParams.delete('ssl');
  parsedUrl.searchParams.delete('uselibpqcompat');

  const timeoutRaw = Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 10000);
  const connectionTimeoutMillis = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 10000;
  const maxRaw = Number(process.env.DATABASE_POOL_MAX || (isTestMode ? 2 : 10));
  const max = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : (isTestMode ? 2 : 10);

  const config = {
    connectionString: parsedUrl.toString(),
    connectionTimeoutMillis,
    max
  };

  if (useSsl) {
    const rejectUnauthorized =
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true' ||
      sslParam === 'verify-full';
    config.ssl = { rejectUnauthorized };
  }

  return { config, useSsl, host };
}

function isTestExecution() {
  return (
    process.env.NODE_ENV === 'test' ||
    process.execArgv.some(arg => arg.includes('--test')) ||
    process.argv.some(arg => arg.includes('--test') || arg.includes('.test.'))
  );
}

class DbClient {
  constructor() {
    this.mode = 'uninitialized';
    this.schema = 'public';
    this.isIsolatedTestSchema = false;
    this.pgPool = null;
    this.pgliteInstance = null;
    this.initializedClients = new WeakSet();
    this.initPromise = null;
    this.pgliteTxQueue = Promise.resolve();
  }

  async init(options = {}) {
    if (this.mode !== 'uninitialized') return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._initInternal(options);
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async _initInternal({ applySchema = true } = {}) {
    const isTestMode = isTestExecution();
    const forceEmbedded = ['1', 'true'].includes(String(process.env.FORCE_EMBEDDED_DB || '').toLowerCase());
    const allowFallback = ['1', 'true'].includes(
      String(process.env.ALLOW_EMBEDDED_DB_FALLBACK || '').toLowerCase()
    );

    const hasSeparateTestDb = isTestMode && Boolean(process.env.TEST_DATABASE_URL?.trim());
    const connectionString = hasSeparateTestDb
      ? process.env.TEST_DATABASE_URL.trim()
      : process.env.DATABASE_URL?.trim();

    let targetSchema = 'public';
    let isolatedTestSchema = false;

    if (isTestMode && connectionString && !hasSeparateTestDb) {
      const baseTestSchema = assertSafeIdentifier(
        process.env.TEST_SCHEMA?.trim() || 'sweety_test',
        'TEST_SCHEMA'
      );
      if (baseTestSchema.toLowerCase() === 'public') {
        throw new Error('TEST_SCHEMA cannot be "public" when sharing DATABASE_URL.');
      }
      targetSchema = `${baseTestSchema}_${process.pid}`;
      isolatedTestSchema = true;
    } else if (!isTestMode && process.env.DATABASE_SCHEMA?.trim()) {
      targetSchema = assertSafeIdentifier(process.env.DATABASE_SCHEMA.trim(), 'DATABASE_SCHEMA');
    }

    let connectedToPostgres = false;

    if (connectionString && !forceEmbedded) {
      const { config, useSsl, host } = buildPgPoolConfig(connectionString, { isTestMode });
      const candidatePool = new PgPool(config);

      let testClient;
      try {
        testClient = await candidatePool.connect();
        await testClient.query('SELECT 1');

        if (targetSchema !== 'public') {
          if (applySchema) {
            await testClient.query(`CREATE SCHEMA IF NOT EXISTS "${targetSchema}"`);
          }
          await testClient.query(`SET search_path TO "${targetSchema}"`);
          this.initializedClients.add(testClient);
        }

        this.pgPool = candidatePool;
        this.mode = 'postgres';
        this.schema = targetSchema;
        this.isIsolatedTestSchema = isolatedTestSchema;
        connectedToPostgres = true;
        console.log(
          `Connected to PostgreSQL server (${host}, SSL=${useSsl ? 'enabled' : 'disabled'}, schema=${targetSchema}).`
        );
      } catch (err) {
        if (testClient) {
          try {
            testClient.release(true);
          } catch {
            // ignore release cleanup error
          }
        }
        await candidatePool.end().catch(() => {});

        const sanitizedError = sanitizeConnectionError(err, connectionString);
        if (!allowFallback) {
          throw new Error(`Failed to connect to PostgreSQL database (${host}): ${sanitizedError}`);
        }
        console.warn(`PostgreSQL connection failed (${host}): ${sanitizedError}`);
        console.warn('Falling back to local embedded PostgreSQL engine (PGlite) because ALLOW_EMBEDDED_DB_FALLBACK is enabled...');
      } finally {
        if (connectedToPostgres && testClient) {
          testClient.release();
        }
      }
    }

    if (!connectedToPostgres) {
      const dataDir = isTestMode
        ? undefined
        : path.resolve(process.cwd(), 'data', 'pgdata');

      if (dataDir && !fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      this.pgliteInstance = new PGlite(dataDir);
      this.mode = 'pglite';
      this.schema = 'public';
      this.isIsolatedTestSchema = false;
      console.log(`Using embedded PostgreSQL engine (${dataDir ? 'persisted at ' + dataDir : 'in-memory'}).`);
    }

    if (applySchema) {
      await this.applySchema();
    }
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
      ALTER TABLE users ENABLE ROW LEVEL SECURITY;
      ALTER TABLE readings ENABLE ROW LEVEL SECURITY;
      DO $$
      BEGIN
        REVOKE ALL ON TABLE users, readings FROM PUBLIC;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          REVOKE ALL ON TABLE users, readings FROM anon;
          REVOKE ALL ON SEQUENCE users_id_seq, readings_id_seq FROM anon;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          REVOKE ALL ON TABLE users, readings FROM authenticated;
          REVOKE ALL ON SEQUENCE users_id_seq, readings_id_seq FROM authenticated;
        END IF;
      END $$;
    `;

    if (this.mode === 'postgres') {
      await this.query(ddl);
    } else {
      await this.pgliteInstance.exec(ddl);
    }
  }

  async query(text, params = []) {
    if (this.mode === 'uninitialized') {
      await this.init();
    }

    if (this.mode === 'postgres') {
      if (this.schema === 'public') {
        const res = await this.pgPool.query(text, params);
        return {
          rows: res.rows,
          rowCount: res.rowCount
        };
      }

      const client = await this.pgPool.connect();
      try {
        if (!this.initializedClients.has(client)) {
          await client.query(`SET search_path TO "${this.schema}"`);
          this.initializedClients.add(client);
        }
        const res = await client.query(text, params);
        return {
          rows: res.rows,
          rowCount: res.rowCount
        };
      } finally {
        client.release();
      }
    } else {
      const res = await this.pgliteInstance.query(text, params);
      return {
        rows: res.rows,
        rowCount: res.rowCount !== undefined ? res.rowCount : (res.affectedRows ?? res.rows.length)
      };
    }
  }

  /**
   * Executes a callback within an explicit database transaction on a single connection.
   * Ensures concurrent PGlite transactions serialize instead of interleaving BEGIN/COMMIT.
   */
  async withTransaction(fn) {
    if (this.mode === 'uninitialized') {
      await this.init();
    }

    if (this.mode === 'postgres') {
      const client = await this.pgPool.connect();
      try {
        if (this.schema !== 'public' && !this.initializedClients.has(client)) {
          await client.query(`SET search_path TO "${this.schema}"`);
          this.initializedClients.add(client);
        }

        await client.query('BEGIN');
        const tx = {
          query: async (text, params = []) => {
            const res = await client.query(text, params);
            return {
              rows: res.rows,
              rowCount: res.rowCount
            };
          }
        };

        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }

    const run = async () => {
      await this.pgliteInstance.query('BEGIN');
      try {
        const tx = {
          query: async (text, params = []) => {
            const res = await this.pgliteInstance.query(text, params);
            return {
              rows: res.rows,
              rowCount: res.rowCount !== undefined ? res.rowCount : (res.affectedRows ?? res.rows.length)
            };
          }
        };
        const result = await fn(tx);
        await this.pgliteInstance.query('COMMIT');
        return result;
      } catch (err) {
        await this.pgliteInstance.query('ROLLBACK').catch(() => {});
        throw err;
      }
    };

    const next = this.pgliteTxQueue.then(run, run);
    this.pgliteTxQueue = next.catch(() => {});
    return next;
  }

  getMode() {
    return this.mode;
  }

  getSchema() {
    return this.schema;
  }

  async cleanupIsolatedTestSchema() {
    if (
      this.mode === 'postgres' &&
      this.pgPool &&
      this.isIsolatedTestSchema &&
      this.schema &&
      this.schema !== 'public'
    ) {
      const client = await this.pgPool.connect();
      try {
        await client.query('SET search_path TO public');
        await client.query(`DROP SCHEMA IF EXISTS "${this.schema}" CASCADE`);
      } finally {
        client.release();
      }
    }
  }

  async end() {
    if (this.pgPool) {
      await this.pgPool.end();
      this.pgPool = null;
    }
    if (this.pgliteInstance) {
      await this.pgliteInstance.close?.();
      this.pgliteInstance = null;
    }
    this.initializedClients = new WeakSet();
    this.pgliteTxQueue = Promise.resolve();
    this.schema = 'public';
    this.isIsolatedTestSchema = false;
    this.mode = 'uninitialized';
  }
}

export const pool = new DbClient();

export async function initDb(options = {}) {
  await pool.init(options);
}
