const { IS_PRODUCTION } = require('../config');

function errorHandler(err, _req, res, _next) {
  console.error(err);
  const status = Number(err.status || err.statusCode) || 500;
  // Client errors (4xx) may surface their message; server errors stay generic in production
  // so we never leak DB/internal details to clients.
  const message = status < 500
    ? (err.message || 'Request error')
    : (IS_PRODUCTION ? 'Internal server error' : (err.message || 'Internal server error'));
  res.status(status).json({ error: message });
}

module.exports = { errorHandler };
