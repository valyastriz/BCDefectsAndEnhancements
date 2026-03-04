const cors = require('cors');
const { CLIENT_ORIGINS } = require('../config');

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  return CLIENT_ORIGINS.includes(String(origin || '').trim());
}

function corsOriginHandler(origin, callback) {
  if (isAllowedCorsOrigin(origin)) {
    return callback(null, true);
  }
  return callback(new Error(`Origin ${origin} is not allowed by CORS`));
}

function corsMiddleware() {
  return cors({
    origin: corsOriginHandler,
    credentials: true,
  });
}

module.exports = {
  isAllowedCorsOrigin,
  corsOriginHandler,
  corsMiddleware,
};
