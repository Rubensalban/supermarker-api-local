const config = require('../config/env');

function apiKeyAuth(req, res, next) {
  const key = req.headers['x-api-key'];

  if (!key || key !== config.apiKey) {
    return res.status(401).json({ error: 'API Key invalide ou manquante' });
  }

  next();
}

module.exports = apiKeyAuth;
