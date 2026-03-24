const config = require('./config/env');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const apiKeyAuth = require('./middlewares/apiKeyAuth');
const rateLimiter = require('./middlewares/rateLimiter');
const metricsMiddleware = require('./middlewares/metricsMiddleware');
const errorHandler = require('./middlewares/errorHandler');
const routes = require('./routes');
const { client: promClient } = require('./config/prometheus');
const cronService = require('./services/cronService');
const healthService = require('./services/healthService');
const { appLogger } = require('./utils/logger');

const app = express();

// --- Global middlewares ---
app.use(helmet());
app.use(cors({ origin: config.cors.origins }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined', {
  stream: { write: (msg) => appLogger.info(msg.trim()) },
}));
app.use(metricsMiddleware);

// --- Metrics endpoint (sans auth, filtre IP) ---
app.get('/metrics', (req, res) => {
  const clientIp = req.ip;
  if (!config.metrics.allowedIps.some(ip => clientIp.includes(ip))) {
    return res.status(403).json({ error: 'IP non autorisee' });
  }
  res.set('Content-Type', promClient.register.contentType);
  promClient.register.metrics().then(data => res.send(data));
});

// --- API routes (avec auth) ---
app.use('/api', rateLimiter, apiKeyAuth, routes);

// --- Error handler ---
app.use(errorHandler);

// --- Start ---
const PORT = config.port;

app.listen(PORT, async () => {
  appLogger.info(`API-LOCAL demarree sur le port ${PORT}`);

  // Healthcheck initial
  const status = await healthService.checkAll();
  appLogger.info('Healthcheck initial', status);

  // Demarrer les cron jobs
  cronService.start();
});

module.exports = app;
