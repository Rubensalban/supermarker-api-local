const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const required = [
  'API_KEY',
  'MSSQL_HOST',
  'MSSQL_USER',
  'MSSQL_PASSWORD',
  'MSSQL_DATABASE',
  'VPS_API_URL',
  'SYNC_API_KEY',
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Variable d'environnement manquante : ${key}`);
  }
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3500,
  apiKey: process.env.API_KEY,

  mssql: {
    host: process.env.MSSQL_HOST,
    port: parseInt(process.env.MSSQL_PORT, 10) || 1433,
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    database: process.env.MSSQL_DATABASE,
  },

  vps: {
    url: process.env.VPS_API_URL,
    apiKey: process.env.SYNC_API_KEY,
    hmacSecret: process.env.SYNC_HMAC_SECRET || '',
    hmacEnabled: process.env.SYNC_HMAC_ENABLED === 'true',
    timeout: parseInt(process.env.SYNC_TIMEOUT, 10) || 60000,
    batchSize: parseInt(process.env.SYNC_BATCH_SIZE, 10) || 50,
    retryMax: parseInt(process.env.SYNC_RETRY_MAX, 10) || 3,
    retryBaseDelay: parseInt(process.env.SYNC_RETRY_BASE_DELAY, 10) || 2000,
  },

  sync: {
    incrementalInterval: parseInt(process.env.SYNC_INCREMENTAL_INTERVAL, 10) || 5,
    fullInterval: parseInt(process.env.SYNC_FULL_INTERVAL, 10) || 180,
    queueProcessInterval: parseInt(process.env.QUEUE_PROCESS_INTERVAL, 10) || 60,
    healthcheckInterval: parseInt(process.env.HEALTHCHECK_INTERVAL, 10) || 60,
    healthcheckBackoffMax: parseInt(process.env.HEALTHCHECK_BACKOFF_MAX, 10) || 300,
    startDate: (process.env.SYNC_START_DATE || '').trim() || null,
    articleCacheTtl: parseInt(process.env.SYNC_ARTICLE_CACHE_TTL, 10) || 600,
    readPageSize: parseInt(process.env.SYNC_READ_PAGE_SIZE, 10) || 500,
    deletionsChunkSize: parseInt(process.env.SYNC_DELETIONS_CHUNK, 10) || 1000,
    // Nombre de batches envoyés en parallèle vers l'API-ONLINE (backpressure).
    // 1 = strictement séquentiel (comportement historique). 3-4 = bon compromis
    // débit/charge VPS sans saturer la pool PostgreSQL côté online.
    sendConcurrency: parseInt(process.env.SYNC_SEND_CONCURRENCY, 10) || 3,
  },

  circuitBreaker: {
    threshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD, 10) || 3,
    cooldown: parseInt(process.env.CIRCUIT_BREAKER_COOLDOWN, 10) || 300,
  },

  alerts: {
    checkInterval: parseInt(process.env.ALERT_CHECK_INTERVAL, 10) || 60,
    queueWarning: parseInt(process.env.ALERT_QUEUE_WARNING, 10) || 1000,
    queueCritical: parseInt(process.env.ALERT_QUEUE_CRITICAL, 10) || 5000,
    syncLatencyMax: parseInt(process.env.ALERT_SYNC_LATENCY_MAX, 10) || 60,
  },

  metrics: {
    enabled: process.env.METRICS_ENABLED !== 'false',
    allowedIps: (process.env.METRICS_ALLOWED_IPS || '127.0.0.1,::1').split(',').map(ip => ip.trim()),
  },

  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(o => o.trim()),
  },
};
