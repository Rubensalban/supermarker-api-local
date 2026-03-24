const client = require('prom-client');
const config = require('./env');

if (config.metrics.enabled) {
  client.collectDefaultMetrics({ prefix: '' });
}

// --- Synchronisation ---
const syncCyclesTotal = new client.Counter({
  name: 'sync_cycles_total',
  help: 'Nombre total de cycles de sync executes',
  labelNames: ['entity', 'type', 'status'],
});

const syncRecordsProcessedTotal = new client.Counter({
  name: 'sync_records_processed_total',
  help: 'Nombre d\'enregistrements traites',
  labelNames: ['entity', 'operation'],
});

const syncCycleDuration = new client.Histogram({
  name: 'sync_cycle_duration_seconds',
  help: 'Duree d\'un cycle de sync',
  labelNames: ['entity', 'type'],
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
});

const syncLastSuccess = new client.Gauge({
  name: 'sync_last_success_timestamp',
  help: 'Timestamp de la derniere sync reussie',
  labelNames: ['entity', 'type'],
});

const syncErrorsTotal = new client.Counter({
  name: 'sync_errors_total',
  help: 'Nombre d\'erreurs par type',
  labelNames: ['entity', 'error_type'],
});

// --- Communication API-VPS ---
const vpsRequestsTotal = new client.Counter({
  name: 'vps_requests_total',
  help: 'Nombre total d\'appels vers API-VPS',
  labelNames: ['endpoint', 'status'],
});

const vpsRequestDuration = new client.Histogram({
  name: 'vps_request_duration_seconds',
  help: 'Latence des appels vers API-VPS',
  labelNames: ['endpoint'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});

const vpsConnectionUp = new client.Gauge({
  name: 'vps_connection_up',
  help: '1 = API-VPS accessible, 0 = inaccessible',
});

const vpsRecordsSentTotal = new client.Counter({
  name: 'vps_records_sent_total',
  help: 'Nombre de records envoyes avec succes',
  labelNames: ['entity'],
});

const vpsRecordsRejectedTotal = new client.Counter({
  name: 'vps_records_rejected_total',
  help: 'Nombre de records rejetes par API-VPS',
  labelNames: ['entity'],
});

// --- Queue locale ---
const queueSize = new client.Gauge({
  name: 'queue_size',
  help: 'Nombre d\'elements dans la queue par statut',
  labelNames: ['status'],
});

const queueOldestPending = new client.Gauge({
  name: 'queue_oldest_pending_seconds',
  help: 'Age du plus ancien element PENDING',
});

const queueProcessedTotal = new client.Counter({
  name: 'queue_processed_total',
  help: 'Nombre d\'elements depiles',
  labelNames: ['status'],
});

const queueProcessingDuration = new client.Histogram({
  name: 'queue_processing_duration_seconds',
  help: 'Duree de traitement d\'un element de queue',
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

// --- Connexions ---
const dbConnectionUp = new client.Gauge({
  name: 'db_connection_up',
  help: '1 = connecte, 0 = deconnecte',
  labelNames: ['database'],
});

const dbConnectionLatency = new client.Histogram({
  name: 'db_connection_latency_seconds',
  help: 'Latence du healthcheck',
  labelNames: ['database'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
});

const dbConnectionErrorsTotal = new client.Counter({
  name: 'db_connection_errors_total',
  help: 'Nombre total d\'erreurs de connexion',
  labelNames: ['database'],
});

// --- Alertes ---
const alertsActive = new client.Gauge({
  name: 'alerts_active',
  help: 'Nombre d\'alertes actives par niveau',
  labelNames: ['level'],
});

const alertsFiredTotal = new client.Counter({
  name: 'alerts_fired_total',
  help: 'Nombre total d\'alertes declenchees',
  labelNames: ['rule', 'level'],
});

// --- HTTP ---
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Nombre total de requetes HTTP',
  labelNames: ['method', 'route', 'status'],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duree des requetes HTTP',
  labelNames: ['method', 'route'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
});

module.exports = {
  client,
  syncCyclesTotal,
  syncRecordsProcessedTotal,
  syncCycleDuration,
  syncLastSuccess,
  syncErrorsTotal,
  vpsRequestsTotal,
  vpsRequestDuration,
  vpsConnectionUp,
  vpsRecordsSentTotal,
  vpsRecordsRejectedTotal,
  queueSize,
  queueOldestPending,
  queueProcessedTotal,
  queueProcessingDuration,
  dbConnectionUp,
  dbConnectionLatency,
  dbConnectionErrorsTotal,
  alertsActive,
  alertsFiredTotal,
  httpRequestsTotal,
  httpRequestDuration,
};
