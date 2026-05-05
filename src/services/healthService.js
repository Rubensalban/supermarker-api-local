const { testConnection } = require('../config/database');
const vpsService = require('./vpsService');
const metrics = require('../config/prometheus');
const config = require('../config/env');
const { appLogger } = require('../utils/logger');

let vpsUp = false;
let sqlServerUp = false;

// Backoff: skip des checks quand le VPS est down depuis longtemps
// (evite de marteler un reseau lent / VPS injoignable)
let vpsDownStreak = 0;
let nextVpsCheckAt = 0;

async function checkSqlServer() {
  const start = process.hrtime.bigint();
  try {
    const ok = await testConnection();
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    metrics.dbConnectionLatency.observe({ database: 'sqlserver' }, duration);
    metrics.dbConnectionUp.set({ database: 'sqlserver' }, ok ? 1 : 0);

    if (!ok && sqlServerUp) {
      appLogger.error('Connexion SQL Server perdue');
    }
    if (ok && !sqlServerUp) {
      appLogger.info('Connexion SQL Server retablie');
    }
    sqlServerUp = ok;
    return ok;
  } catch (err) {
    metrics.dbConnectionUp.set({ database: 'sqlserver' }, 0);
    metrics.dbConnectionErrorsTotal.inc({ database: 'sqlserver' });
    sqlServerUp = false;
    return false;
  }
}

async function checkVps() {
  // Backoff: si VPS down, espacer les checks (30s -> 60s -> 120s -> ... -> max)
  if (Date.now() < nextVpsCheckAt) {
    return vpsUp;
  }

  const start = process.hrtime.bigint();
  try {
    const ok = await vpsService.checkHealth();
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    metrics.dbConnectionLatency.observe({ database: 'api-vps' }, duration);
    metrics.vpsConnectionUp.set(ok ? 1 : 0);

    if (!ok && vpsUp) {
      appLogger.error('API-VPS inaccessible');
    }
    if (ok && !vpsUp) {
      appLogger.info('API-VPS de nouveau accessible');
    }

    if (ok) {
      vpsDownStreak = 0;
      nextVpsCheckAt = 0;
    } else {
      vpsDownStreak++;
      const base = config.sync.healthcheckInterval;
      const backoff = Math.min(base * Math.pow(2, vpsDownStreak - 1), config.sync.healthcheckBackoffMax);
      nextVpsCheckAt = Date.now() + backoff * 1000;
    }

    vpsUp = ok;
    return ok;
  } catch {
    metrics.vpsConnectionUp.set(0);
    vpsUp = false;
    vpsDownStreak++;
    const base = config.sync.healthcheckInterval;
    const backoff = Math.min(base * Math.pow(2, vpsDownStreak - 1), config.sync.healthcheckBackoffMax);
    nextVpsCheckAt = Date.now() + backoff * 1000;
    return false;
  }
}

function isVpsUp() {
  return vpsUp;
}

function isSqlServerUp() {
  return sqlServerUp;
}

async function checkAll() {
  const [sqlOk, vpsOk] = await Promise.all([checkSqlServer(), checkVps()]);
  return { sqlServer: sqlOk, vps: vpsOk };
}

module.exports = { checkSqlServer, checkVps, isVpsUp, isSqlServerUp, checkAll };
