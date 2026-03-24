const rateMap = new Map();

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 100;

function rateLimiter(req, res, next) {
  const ip = req.ip;
  const now = Date.now();

  if (!rateMap.has(ip)) {
    rateMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  const entry = rateMap.get(ip);

  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + WINDOW_MS;
    return next();
  }

  entry.count++;

  if (entry.count > MAX_REQUESTS) {
    res.set('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
    return res.status(429).json({ error: 'Trop de requetes, reessayez plus tard' });
  }

  next();
}

// Nettoyage periodique des entrees expirees
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateMap) {
    if (now > entry.resetAt) {
      rateMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);

module.exports = rateLimiter;
