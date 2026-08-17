#!/usr/bin/env node
import pg from 'pg';

const pool = new pg.Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'eye_app',
  password: 'Ino#55645564',
  database: 'eye_vision',
});

try {
  const result = await pool.query('SELECT COUNT(*) FROM offices');
  console.log('[SUCCESS]', result.rows);
  process.exit(0);
} catch (err) {
  console.error('[ERROR]', err.message);
  process.exit(1);
} finally {
  await pool.end();
}
