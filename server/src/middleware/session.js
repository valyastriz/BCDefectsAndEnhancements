const session = require('express-session');
const {
  SESSION_SECRET,
  SESSION_COOKIE_SAME_SITE,
  SESSION_COOKIE_SECURE,
  SESSION_COOKIE_DOMAIN,
} = require('../config');

function createSessionMiddleware() {
  return session({
    name: 'bc_sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: SESSION_COOKIE_SAME_SITE,
      secure: SESSION_COOKIE_SECURE,
      maxAge: 1000 * 60 * 60 * 8,
      ...(SESSION_COOKIE_DOMAIN ? { domain: SESSION_COOKIE_DOMAIN } : {}),
    },
  });
}

module.exports = {
  createSessionMiddleware,
};
