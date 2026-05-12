const vpsClient = require('../config/vpsClient');
const { syncLogger } = require('../utils/logger');
const metrics = require('../config/prometheus');

/**
 * Envoie un batch de records a l'API-VPS.
 * @returns {{ status, processed, errors, details }}
 */
async function sendBatch(entityType, operation, records) {
  const { v4: uuidv4 } = require('uuid');
  const batchId = uuidv4();
  const endpoint = `/receive/${entityType}s`;

  const payload = {
    entity_type: entityType,
    operation,
    batch_id: batchId,
    timestamp: new Date().toISOString(),
    records,
  };

  const timer = metrics.vpsRequestDuration.startTimer({ endpoint });

  try {
    const response = await vpsClient.post(endpoint, payload);
    timer();

    const data = response.data;
    const httpStatus = String(response.status);
    metrics.vpsRequestsTotal.inc({ endpoint, status: httpStatus });

    if (data.processed) {
      metrics.vpsRecordsSentTotal.inc({ entity: entityType }, data.processed);
    }
    if (data.errors) {
      metrics.vpsRecordsRejectedTotal.inc({ entity: entityType }, data.errors);
    }

    syncLogger.info('Batch envoye a API-VPS', {
      batchId,
      entityType,
      operation,
      processed: data.processed,
      errors: data.errors,
    });

    return data;
  } catch (err) {
    timer();
    const httpStatus = err.response ? String(err.response.status) : 'network_error';
    metrics.vpsRequestsTotal.inc({ endpoint, status: httpStatus });

    syncLogger.error('Echec envoi batch API-VPS', {
      batchId,
      entityType,
      error: err.message,
      status: httpStatus,
    });

    throw err;
  }
}

/**
 * Envoie la liste des IDs actifs pour detection des suppressions.
 */
async function sendDeletions(entityType, activeSageIds) {
  const endpoint = '/receive/deletions';

  const payload = {
    entity_type: entityType,
    timestamp: new Date().toISOString(),
    active_sage_ids: activeSageIds,
  };

  const timer = metrics.vpsRequestDuration.startTimer({ endpoint });

  try {
    const response = await vpsClient.post(endpoint, payload);
    timer();
    metrics.vpsRequestsTotal.inc({ endpoint, status: String(response.status) });

    syncLogger.info('Deletions envoyees a API-VPS', {
      entityType,
      activeCount: activeSageIds.length,
      deletedCount: response.data.deleted_count,
    });

    return response.data;
  } catch (err) {
    timer();
    const httpStatus = err.response ? String(err.response.status) : 'network_error';
    metrics.vpsRequestsTotal.inc({ endpoint, status: httpStatus });
    throw err;
  }
}

/**
 * Verifie cote API-VPS la presence d'une liste de sage_ids.
 * Renvoie { missing_sage_ids: [...] } : ids envoyes mais absents/soft-deleted online.
 */
async function checkPresence(entityType, sageIds) {
  const endpoint = '/check';
  const payload = { entity_type: entityType, sage_ids: sageIds };
  const timer = metrics.vpsRequestDuration.startTimer({ endpoint });
  try {
    const response = await vpsClient.post(endpoint, payload);
    timer();
    metrics.vpsRequestsTotal.inc({ endpoint, status: String(response.status) });
    return response.data;
  } catch (err) {
    timer();
    const httpStatus = err.response ? String(err.response.status) : 'network_error';
    metrics.vpsRequestsTotal.inc({ endpoint, status: httpStatus });
    syncLogger.error('Echec check presence API-VPS', { entityType, error: err.message });
    throw err;
  }
}

/**
 * Healthcheck API-VPS.
 */
async function checkHealth() {
  try {
    const response = await vpsClient.get('/health', { timeout: 5000 });
    return response.status === 200;
  } catch {
    return false;
  }
}

module.exports = { sendBatch, sendDeletions, checkPresence, checkHealth };
