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
    timeout: parseInt(process.env.SYNC_TIMEOUT, 10) || 30000,
    batchSize: parseInt(process.env.SYNC_BATCH_SIZE, 10) || 100,
  },

  sync: {
    incrementalInterval: parseInt(process.env.SYNC_INCREMENTAL_INTERVAL, 10) || 2,
    fullInterval: parseInt(process.env.SYNC_FULL_INTERVAL, 10) || 60,
    queueProcessInterval: parseInt(process.env.QUEUE_PROCESS_INTERVAL, 10) || 30,
    healthcheckInterval: parseInt(process.env.HEALTHCHECK_INTERVAL, 10) || 30,
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
