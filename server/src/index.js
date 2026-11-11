import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { initDb, pool } from './db.js';
import { getJwtSecret } from './auth.js';
import { createAuthRouter } from './routes/auth.js';
import readingRoutes from './routes/readings.js';
import reportRoutes from './routes/reports.js';

dotenv.config();

const LOCAL_DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/**
 * Resolves allowed CORS origins from CLIENT_ORIGIN (comma-separated).
 * Local Vite dev origins are included automatically outside production.
 */
export function getAllowedOrigins({
  nodeEnv = process.env.NODE_ENV,
  clientOrigin = process.env.CLIENT_ORIGIN
} = {}) {
  const configuredOrigins = String(clientOrigin || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  if (nodeEnv === 'production') {
    return Array.from(new Set(configuredOrigins));
  }

  return Array.from(new Set([...configuredOrigins, ...LOCAL_DEV_ORIGINS]));
}

export function createCorsOptions({
  nodeEnv = process.env.NODE_ENV,
  clientOrigin = process.env.CLIENT_ORIGIN
} = {}) {
  const allowedOriginSet = new Set(getAllowedOrigins({ nodeEnv, clientOrigin }));

  return {
    origin(requestOrigin, callback) {
      if (!requestOrigin || allowedOriginSet.has(requestOrigin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true
  };
}

function resolveTrustProxy(rawValue) {
  if (rawValue === undefined || rawValue === '') return undefined;
  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;
  if (/^\d+$/.test(rawValue)) return Number(rawValue);
  return rawValue;
}

/**
 * Builds an Express application instance with security headers, CORS, JSON limits, and API routes.
 */
export function createApp({
  nodeEnv = process.env.NODE_ENV,
  clientOrigin = process.env.CLIENT_ORIGIN,
  jsonBodyLimit = process.env.JSON_BODY_LIMIT || '16kb',
  trustProxy = resolveTrustProxy(process.env.TRUST_PROXY),
  rateLimitWindowMs,
  loginRateLimitMax,
  registerRateLimitMax
} = {}) {
  const app = express();

  if (trustProxy !== undefined) {
    app.set('trust proxy', trustProxy);
  }

  app.use(helmet());
  app.use(cors(createCorsOptions({ nodeEnv, clientOrigin })));
  app.use(express.json({ limit: jsonBodyLimit }));

  app.get('/api/health', (req, res) =>
    res.json({ status: 'ok', dbEngine: pool.getMode(), timestamp: new Date().toISOString() })
  );
  app.use(
    '/api/auth',
    createAuthRouter({
      windowMs: rateLimitWindowMs,
      loginLimit: loginRateLimitMax,
      registerLimit: registerRateLimitMax
    })
  );
  app.use('/api/readings', readingRoutes);
  app.use('/api/reports', reportRoutes);

  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large' || err?.status === 413) {
      return res.status(413).json({ error: 'Request payload is too large.' });
    }
    if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400 && 'body' in err)) {
      return res.status(400).json({ error: 'Invalid JSON request body.' });
    }
    console.error('Unhandled API error:', err);
    res.status(500).json({ error: 'Unexpected server error.' });
  });

  return app;
}

const app = createApp();

const port = process.env.PORT || 5000;

const isTestMode =
  process.env.NODE_ENV === 'test' ||
  process.execArgv.some(arg => arg.includes('--test')) ||
  process.argv.some(arg => arg.includes('--test') || arg.includes('.test.'));

if (!isTestMode) {
  try {
    getJwtSecret();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  initDb()
    .then(() => {
      app.listen(port, () => console.log(`Sweety API listening on port ${port}`));
    })
    .catch(err => {
      console.error('Database initialization failed:', err);
      process.exit(1);
    });
}

export { app };

process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
