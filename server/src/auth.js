import crypto from 'crypto';
import jwt from 'jsonwebtoken';

let ephemeralTestSecret = null;

function isTestEnvironment() {
  return (
    process.env.NODE_ENV === 'test' ||
    process.execArgv.some((arg) => arg.includes('--test')) ||
    process.argv.some((arg) => arg.includes('--test') || arg.includes('.test.'))
  );
}

export function getJwtSecret() {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured) {
    return configured;
  }

  if (isTestEnvironment()) {
    if (!ephemeralTestSecret) {
      ephemeralTestSecret = crypto.randomBytes(32).toString('hex');
    }
    return ephemeralTestSecret;
  }

  throw new Error(
    'JWT_SECRET environment variable is required. Copy server/.env.example to server/.env and configure a secure secret.'
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Please log in to continue.' });
  }

  try {
    req.user = jwt.verify(token, getJwtSecret());
    next();
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
}
