const db = require('../config/sqlite');
const metrics = require('../config/prometheus');
const config = require('../config/env');
const { alertLogger } = require('../utils/logger');
const queueService = require('./queueService');
const healthService = require('./healthService');

const insertAlert = db.prepare(`
  INSERT INTO alert_history (rule, level, message, context)
  VALUES (?, ?, ?, ?)
`);

const getActiveAlerts = db.prepare(`
  SELECT * FROM alert_history
  WHERE acknowledged = 0
  ORDER BY created_at DESC
`);

const getAlertHistory = db.prepare(`
  SELECT * FROM alert_history
  ORDER BY created_at DESC
  LIMIT ? OFFSET ?
`);

const acknowledgeAlert = db.prepare(`
  UPDATE alert_history SET acknowledged = 1 WHERE id = ?
`);

let consecutiveFailures = {};

function fireAlert(rule, level, message, context = {}) {
  const contextJson = JSON.stringify(context);

  insertAlert.run(rule, level, message, contextJson);

  alertLogger[level === 'CRITICAL' || level === 'ERROR' ? 'error' : level === 'WARNING' ? 'warn' : 'info']({
    rule,
    level,
    message,
    context,
  });

  metrics.alertsFiredTotal.inc({ rule, level });
}

function evaluate() {
  const stats = queueService.getStats();
  const pendingCount = stats.PENDING || 0;
  const failedCount = stats.FAILED || 0;

  // Queue thresholds
  if (pendingCount >= config.alerts.queueCritical) {
    fireAlert('queue_threshold_critical', 'CRITICAL',
      `Queue locale a ${pendingCount} elements en attente`,
      { pending: pendingCount });
  } else if (pendingCount >= config.alerts.queueWarning) {
    fireAlert('queue_threshold_warning', 'WARNING',
      `Queue locale a ${pendingCount} elements en attente`,
      { pending: pendingCount });
  }

  // API-VPS down
  if (!healthService.isVpsUp()) {
    fireAlert('api_vps_unreachable', 'CRITICAL',
      'API-VPS inaccessible',
      { checked_at: new Date().toISOString() });
  }

  // SQL Server down
  if (!healthService.isSqlServerUp()) {
    fireAlert('connection_lost_sqlserver', 'CRITICAL',
      'SQL Server inaccessible',
      { checked_at: new Date().toISOString() });
  }

  // Update active alerts metric
  const active = getActiveAlerts.all();
  const byLevel = { INFO: 0, WARNING: 0, ERROR: 0, CRITICAL: 0 };
  for (const alert of active) {
    if (byLevel[alert.level] !== undefined) byLevel[alert.level]++;
  }
  for (const [level, count] of Object.entries(byLevel)) {
    metrics.alertsActive.set({ level }, count);
  }
}

function trackSyncResult(entityType, success) {
  if (!consecutiveFailures[entityType]) consecutiveFailures[entityType] = 0;

  if (success) {
    if (consecutiveFailures[entityType] > 0) {
      fireAlert('connection_restored', 'INFO',
        `Sync ${entityType} retablie apres ${consecutiveFailures[entityType]} echecs`,
        { entity: entityType });
    }
    consecutiveFailures[entityType] = 0;
  } else {
    consecutiveFailures[entityType]++;
    fireAlert('sync_failure', 'ERROR',
      `Echec sync ${entityType}`,
      { entity: entityType, consecutive: consecutiveFailures[entityType] });

    if (consecutiveFailures[entityType] >= 3) {
      fireAlert('sync_consecutive_failures', 'CRITICAL',
        `${consecutiveFailures[entityType]} echecs consecutifs pour ${entityType}`,
        { entity: entityType });
    }
  }
}

module.exports = {
  fireAlert,
  evaluate,
  trackSyncResult,
  getActiveAlerts: () => getActiveAlerts.all(),
  getAlertHistory: (limit = 50, offset = 0) => getAlertHistory.all(limit, offset),
  acknowledgeAlert: (id) => acknowledgeAlert.run(id),
};
