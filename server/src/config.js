const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

const NODE_ENV = String(process.env.NODE_ENV || 'development').toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 4000);
const CLIENT_ORIGINS = String(process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((value) => String(value || '').trim())
  .filter(Boolean);
const CLIENT_ORIGIN = CLIENT_ORIGINS[0] || 'http://localhost:5173';
const SESSION_SECRET = process.env.SESSION_SECRET || 'local-dev-secret-change-me';
const SESSION_COOKIE_SAME_SITE = String(
  process.env.SESSION_COOKIE_SAME_SITE || (IS_PRODUCTION ? 'none' : 'lax'),
).toLowerCase();
const SESSION_COOKIE_SECURE = String(process.env.SESSION_COOKIE_SECURE || (IS_PRODUCTION ? 'true' : 'false')).toLowerCase() === 'true';
const SESSION_COOKIE_DOMAIN = String(process.env.SESSION_COOKIE_DOMAIN || '').trim() || null;

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_STORAGE_BUCKET = String(process.env.SUPABASE_STORAGE_BUCKET || 'attachments').trim();
const SUPABASE_STORAGE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && SUPABASE_STORAGE_BUCKET);

const uploadsRoot = path.join(__dirname, '..', 'uploads');
const tempUploadDir = path.join(uploadsRoot, 'tmp');

fs.mkdirSync(tempUploadDir, { recursive: true });

module.exports = {
  NODE_ENV,
  IS_PRODUCTION,
  PORT,
  CLIENT_ORIGINS,
  CLIENT_ORIGIN,
  SESSION_SECRET,
  SESSION_COOKIE_SAME_SITE,
  SESSION_COOKIE_SECURE,
  SESSION_COOKIE_DOMAIN,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_STORAGE_BUCKET,
  SUPABASE_STORAGE_ENABLED,
  uploadsRoot,
  tempUploadDir,
};
