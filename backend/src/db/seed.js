/**
 * Seeds the database with:
 *  - 1 Super Admin account (credentials from .env or defaults below)
 *  - 2 sample counselors (optional, for testing)
 *
 * Run with: npm run seed
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function seed() {
  const client = await pool.connect();
  try {
    const email = process.env.SEED_ADMIN_EMAIL || 'admin@degreeverse.com';
    const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe@123';
    const name = process.env.SEED_ADMIN_NAME || 'Degreeverse Super Admin';

    const { rows: existing } = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.length) {
      console.log(`Super admin already exists (${email}). Skipping.`);
    } else {
      const hash = await bcrypt.hash(password, 10);
      const { rows: roleRows } = await client.query("SELECT id FROM roles WHERE name = 'super_admin'");
      await client.query(
        `INSERT INTO users (name, email, password_hash, role_id, is_active)
         VALUES ($1, $2, $3, $4, TRUE)`,
        [name, email, hash, roleRows[0].id]
      );
      console.log('----------------------------------------------------');
      console.log('Super Admin created:');
      console.log(`  Email:    ${email}`);
      console.log(`  Password: ${password}`);
      console.log('  >>> Log in and change this password immediately. <<<');
      console.log('----------------------------------------------------');
    }

    // Optional sample counselors for quick testing — comment out for production
    if (process.env.SEED_SAMPLE_DATA === 'true') {
      const { rows: counselorRole } = await client.query("SELECT id FROM roles WHERE name = 'counselor'");
      const sampleCounselors = [
        { name: 'Priya Sharma', email: 'priya@degreeverse.com', mobile: '9800000001' },
        { name: 'Rahul Verma', email: 'rahul@degreeverse.com', mobile: '9800000002' },
      ];
      for (const c of sampleCounselors) {
        const { rows: exists } = await client.query('SELECT id FROM users WHERE email = $1', [c.email]);
        if (exists.length) continue;
        const hash = await bcrypt.hash('Counselor@123', 10);
        await client.query(
          `INSERT INTO users (name, email, mobile, password_hash, role_id, is_active)
           VALUES ($1, $2, $3, $4, $5, TRUE)`,
          [c.name, c.email, c.mobile, hash, counselorRole[0].id]
        );
      }
      console.log('Sample counselors created (password: Counselor@123)');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
