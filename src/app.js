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
const { appLogger, accessLogStream } = require('./utils/logger');

const app = express();

// --- Global middlewares ---
app.use(helmet.xssFilter());
app.use(helmet.frameguard({ action: "sameorigin" }));
app.use(helmet.dnsPrefetchControl());
app.use(helmet.referrerPolicy({ policy: "same-origin" }));
app.use(helmet.hsts());
app.use(helmet.noSniff());
app.use(helmet());
app.use(helmet.contentSecurityPolicy({ directives: { defaultSrc: ["'self'"] } }));
app.use(cors({ origin: config.cors.origins }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined', { stream: accessLogStream }));
app.use(metricsMiddleware);

// --- Metrics endpoint (sans auth, filtre IP) ---
app.get('/metrics', (req, res) => {
  const clientIp = req.ip || '';
  const isAllowed = config.metrics.allowedIps.some(ip => clientIp.includes(ip))
    || clientIp.startsWith('172.') || clientIp.startsWith('10.')
    || clientIp.startsWith('192.168.') || clientIp === '::ffff:127.0.0.1';
  if (!isAllowed) {
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

app.listen(PORT, () => {
  appLogger.info(`API-LOCAL demarree sur le port ${PORT}`);

  // Demarrer les cron jobs immediatement (ne pas bloquer sur le healthcheck)
  cronService.start();

  // Healthcheck initial en arriere-plan
  healthService.checkAll()
    .then(status => appLogger.info('Healthcheck initial', status))
    .catch(err => appLogger.error('Healthcheck initial echoue', { error: err.message }));
});

module.exports = app;
