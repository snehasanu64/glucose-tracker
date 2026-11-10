import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDb, pool } from './db.js';
import authRoutes from './routes/auth.js';
import readingRoutes from './routes/readings.js';
import reportRoutes from './routes/reports.js';

dotenv.config();

const app = express();

const clientOrigin = process.env.CLIENT_ORIGIN;
app.use(cors({
  origin: clientOrigin ? [clientOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173'] : true,
  credentials: true
}));

app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.use('/api/auth', authRoutes);
app.use('/api/readings', readingRoutes);
app.use('/api/reports', reportRoutes);

app.use((err, req, res, next) => {
  console.error('Unhandled API error:', err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

const port = process.env.PORT || 5000;

const isTestMode =
  process.env.NODE_ENV === 'test' ||
  process.execArgv.some(arg => arg.includes('--test')) ||
  process.argv.some(arg => arg.includes('--test') || arg.includes('.test.'));

if (!isTestMode) {
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
