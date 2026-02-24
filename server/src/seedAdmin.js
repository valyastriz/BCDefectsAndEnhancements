const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const { initDb } = require('./db');

dotenv.config();

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function seedAdmin() {
  const usernames = parseCsv(
    process.env.ADMIN_LOGINS ||
      process.env.SEED_ADMIN_LOGINS ||
      process.env.SEED_ADMIN_USERNAME ||
      process.env.ADMIN_USERNAME ||
      'admin',
  );
  const password = process.env.SEED_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'admin123';

  const db = await initDb();

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    for (const username of usernames) {
      const existing = await db.get('SELECT id FROM users WHERE username = ?', [username]);

      if (existing) {
        console.log(`Admin user '${username}' already exists.`);
        continue;
      }

      await db.run(
        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
        [username, passwordHash, 'admin'],
      );

      console.log(`Seeded admin user '${username}'.`);
    }
  } finally {
    await db.close();
  }
}

seedAdmin().catch((error) => {
  console.error(error);
  process.exit(1);
});
