const crypto = require('crypto');

/**
 * Genere une signature HMAC-SHA256 pour un payload JSON.
 */
function sign(payload, secret) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Verifie qu'une signature correspond au payload.
 */
function verify(payload, signature, secret) {
  const expected = sign(payload, secret);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

module.exports = { sign, verify };
