import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { pool, initDb } from './db.js';

dotenv.config();

export async function runSeed() {
  await initDb();
  console.log('Database initialized.');

  const email = 'demo@sweety.local';
  const password = 'DemoPass123!';
  const hash = await bcrypt.hash(password, 12);

  const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  let userId;

  if (existingUser.rows.length > 0) {
    userId = existingUser.rows[0].id;
    await pool.query('UPDATE users SET name = $1, password_hash = $2 WHERE id = $3', ['Demo User', hash, userId]);
    console.log(`Updated existing demo user (ID: ${userId}).`);
  } else {
    const userResult = await pool.query(
      'INSERT INTO users(name, email, password_hash) VALUES($1, $2, $3) RETURNING id',
      ['Demo User', email, hash]
    );
    userId = userResult.rows[0].id;
    console.log(`Created new demo user (ID: ${userId}).`);
  }

  // Clear existing demo user readings to ensure clean deterministic seed data
  await pool.query('DELETE FROM readings WHERE user_id = $1', [userId]);

  const now = new Date();

  // Helper to format Date to YYYY-MM-DD
  const formatDate = d =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const currentMonthReadings = [
    { offsetDays: 0, slot: 'morning', value: 101 },
    { offsetDays: 0, slot: 'after_breakfast', value: 142 },
    { offsetDays: -1, slot: 'morning', value: 104 },
    { offsetDays: -1, slot: 'after_breakfast', value: 151 },
    { offsetDays: -1, slot: 'after_lunch', value: 145 },
    { offsetDays: -1, slot: 'after_dinner', value: 132 },
    { offsetDays: -2, slot: 'morning', value: 108 },
    { offsetDays: -2, slot: 'after_breakfast', value: 139 },
    { offsetDays: -2, slot: 'after_lunch', value: 136 },
    { offsetDays: -2, slot: 'after_dinner', value: 129 },
    { offsetDays: -3, slot: 'morning', value: 98 },
    { offsetDays: -3, slot: 'after_breakfast', value: 135 },
    { offsetDays: -3, slot: 'after_lunch', value: 128 },
    { offsetDays: -3, slot: 'after_dinner', value: 124 },
    { offsetDays: -5, slot: 'morning', value: 105 },
    { offsetDays: -5, slot: 'after_breakfast', value: 148 },
    { offsetDays: -7, slot: 'morning', value: 102 },
    { offsetDays: -7, slot: 'after_lunch', value: 133 }
  ];

  for (const item of currentMonthReadings) {
    const dateObj = new Date(now);
    dateObj.setDate(dateObj.getDate() + item.offsetDays);
    const day = formatDate(dateObj);
    await pool.query(
      `INSERT INTO readings(user_id, reading_date, slot, value)
       VALUES($1, $2, $3, $4)
       ON CONFLICT(user_id, reading_date, slot)
       DO UPDATE SET value = EXCLUDED.value`,
      [userId, day, item.slot, item.value]
    );
  }

  // Previous month sample readings
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const prevMonthYear = prevMonthDate.getFullYear();
  const prevMonthNum = prevMonthDate.getMonth() + 1;
  const prevMonthPrefix = `${prevMonthYear}-${String(prevMonthNum).padStart(2, '0')}`;

  const prevMonthSamples = [
    { day: '05', slot: 'morning', value: 110 },
    { day: '05', slot: 'after_breakfast', value: 155 },
    { day: '10', slot: 'morning', value: 105 },
    { day: '10', slot: 'after_lunch', value: 138 },
    { day: '15', slot: 'morning', value: 102 },
    { day: '15', slot: 'after_dinner', value: 130 },
    { day: '20', slot: 'morning', value: 97 },
    { day: '20', slot: 'after_breakfast', value: 140 }
  ];

  for (const item of prevMonthSamples) {
    const day = `${prevMonthPrefix}-${item.day}`;
    await pool.query(
      `INSERT INTO readings(user_id, reading_date, slot, value)
       VALUES($1, $2, $3, $4)
       ON CONFLICT(user_id, reading_date, slot)
       DO UPDATE SET value = EXCLUDED.value`,
      [userId, day, item.slot, item.value]
    );
  }

  console.log('Seed completed successfully!');
  console.log('----------------------------------------------------');
  console.log('Demo Login Credentials:');
  console.log(`Email:    ${email}`);
  console.log(`Password: ${password}`);
  console.log('----------------------------------------------------');
}

if (process.argv[1]?.endsWith('seed.js')) {
  try {
    await runSeed();
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Seed script failed:', err);
    await pool.end();
    process.exit(1);
  }
}
