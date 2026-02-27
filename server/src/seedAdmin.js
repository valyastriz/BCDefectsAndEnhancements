const dotenv = require('dotenv');
const bcrypt = require('bcrypt');

dotenv.config();

const db = require('../db');

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

  await db.init();

  try {
    const dbModels = db.getModels() || {};
    const User = dbModels.User;
    if (!User) {
      throw new Error('User model is not initialized');
    }
    const passwordHash = await bcrypt.hash(password, 10);

    for (const username of usernames) {
      const existing = await User.findOne({
        where: { username },
        attributes: ['id'],
        raw: true,
      });

      if (existing) {
        console.log(`Admin user '${username}' already exists.`);
        continue;
      }

      await User.create({
        username,
        password_hash: passwordHash,
        role: 'admin',
      });

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
