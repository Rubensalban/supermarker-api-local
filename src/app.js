const config = require('./config/env');
const express = require('express');
const path = require('path');
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
// HSTS et upgrade-insecure-requests désactivés : l'API-LOCAL est servie en HTTP
// sur le LAN. Activer HSTS forçait le navigateur en HTTPS → ERR_SSL_PROTOCOL_ERROR.
app.use(helmet({
  hsts: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
}));
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

// --- UI sync manuelle (page statique, pas d'auth ici — l'auth reste sur /api) ---
// CSP relachee pour /ui : Tailwind CDN + script/style inline
const uiCsp = helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com'],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    connectSrc: ["'self'"],
    upgradeInsecureRequests: null,
  },
});

// Expose la cle API pour la page UI (locale uniquement — meme machine que l'API)
app.get('/ui/config', uiCsp, (req, res) => {
  const ip = req.ip || '';
  const isLocal = ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1'
    || ip.startsWith('172.') || ip.startsWith('10.') || ip.startsWith('192.168.');
  if (!isLocal) {
    return res.status(403).json({ error: 'UI config accessible uniquement en local' });
  }
  res.json({ apiKey: config.apiKey });
});

app.use('/ui', uiCsp, express.static(path.join(__dirname, 'public')));
//app.get('/', (req, res) => res.redirect('/ui/sync.html'));

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

  // Watcher quasi temps reel des tables Sage (declenche la sync a la modification)
  require('./services/changeWatcher').start();

  // Healthcheck initial en arriere-plan
  healthService.checkAll()
    .then(status => appLogger.info('Healthcheck initial', status))
    .catch(err => appLogger.error('Healthcheck initial echoue', { error: err.message }));
});

module.exports = app;
