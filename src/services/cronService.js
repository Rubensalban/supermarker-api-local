const cron = require('node-cron');
const config = require('../config/env');
const { appLogger, syncLogger } = require('../utils/logger');
const syncService = require('./syncService');
const queueService = require('./queueService');
const healthService = require('./healthService');
const alertService = require('./alertService');
const metricsService = require('./metricsService');
const vpsService = require('./vpsService');
const metrics = require('../config/prometheus');

// Locks anti-chevauchement : un cycle long ne doit pas se lancer en double
// si le tick suivant arrive avant la fin (cas : VPS lent + sync incrementale
// toutes les 5min). Sans ces locks, on saturait le VPS et la pool SQL Server.
const locks = {
  incremental: false,
  full: false,
  queue: false,
};

function start() {
  // 1) Recovery au demarrage : les items restes PROCESSING sont issus d'un
  // crash du process precedent (kill du container pendant une sync). On les
  // repasse en PENDING avant de demarrer les crons pour qu'ils soient
  // naturellement repris au premier cycle de queue, sans double envoi.
  try {
    const recovered = queueService.resetStaleProcessing();
    if (recovered > 0) {
      appLogger.info('Startup recovery : items PROCESSING orphelins remis en PENDING', { count: recovered });
    }
  } catch (err) {
    appLogger.error('Startup recovery echoue', { error: err.message });
  }

  // Sync incrementale
  cron.schedule(`*/${config.sync.incrementalInterval} * * * *`, async () => {
    if (syncService.isPaused()) return;
    if (locks.incremental) {
      syncLogger.warn('Cron: sync incrementale precedente encore en cours, tick ignore');
      return;
    }
    locks.incremental = true;
    syncLogger.info('Cron: sync incrementale demarree');
    try {
      const results = await syncService.syncAllIncremental();
      for (const r of results) {
        alertService.trackSyncResult(r.entity, !r.error);
      }
    } catch (err) {
      appLogger.error('Cron: erreur sync incrementale', { error: err.message });
    } finally {
      locks.incremental = false;
    }
  });

  // Sync complete (detection suppressions)
  cron.schedule(`0 */${config.sync.fullInterval} * * * *`, async () => {
    if (syncService.isPaused()) return;
    if (locks.full) {
      syncLogger.warn('Cron: sync complete precedente encore en cours, tick ignore');
      return;
    }
    locks.full = true;
    syncLogger.info('Cron: sync complete demarree');
    try {
      await syncService.syncAllFull();
    } catch (err) {
      appLogger.error('Cron: erreur sync complete', { error: err.message });
    } finally {
      locks.full = false;
    }
  });

  // Traitement de la queue
  cron.schedule(`*/${config.sync.queueProcessInterval} * * * * *`, async () => {
    if (syncService.isPaused()) return;
    if (locks.queue) return; // silencieux : la queue tick chaque minute

    const vpsUp = healthService.isVpsUp();
    if (!vpsUp) return;

    const pending = queueService.getPending(config.vps.batchSize);
    if (pending.length === 0) return;

    locks.queue = true;
    try {

    // Regrouper par entity_type
    const grouped = {};
    for (const item of pending) {
      if (!grouped[item.entity_type]) grouped[item.entity_type] = [];
      grouped[item.entity_type].push(item);
    }

    for (const [entityType, items] of Object.entries(grouped)) {
      const records = items.map(item => {
        queueService.markProcessing(item.id);
        return JSON.parse(item.payload);
      });

      const timer = metrics.queueProcessingDuration.startTimer();
      try {
        const ack = await vpsService.sendBatch(entityType, 'UPSERT', records);
        const confirmed = new Set(Array.isArray(ack && ack.processed_sage_ids) ? ack.processed_sage_ids : []);

        // Si l'API-ONLINE ne renvoie pas la liste (ancienne version), on
        // considère tout confirmé sur succès HTTP — comportement antérieur.
        const fallbackAllOk = confirmed.size === 0 && (!ack || !ack.errors);

        for (const item of items) {
          if (fallbackAllOk || confirmed.has(item.sage_id)) {
            queueService.markDone(item.id);
          } else {
            // Record envoyé mais non confirmé : incrémenter les tentatives et
            // laisser repasser au cycle suivant.
            const errMsg = (ack && ack.details && ack.details.find(d => d.sage_id === item.sage_id)?.error) || 'not confirmed by online';
            if (item.attempts + 1 >= item.max_attempts) {
              queueService.markFailed(item.id, errMsg);
              alertService.fireAlert('queue_item_max_retries', 'ERROR',
                `Element ${item.sage_id} a atteint le max de tentatives`,
                { sage_id: item.sage_id, entity: entityType });
            } else {
              queueService.incrementAttempts(item.id, errMsg);
            }
          }
        }
        timer();
      } catch (err) {
        timer();
        for (const item of items) {
          if (item.attempts + 1 >= item.max_attempts) {
            queueService.markFailed(item.id, err.message);
            alertService.fireAlert('queue_item_max_retries', 'ERROR',
              `Element ${item.sage_id} a atteint le max de tentatives`,
              { sage_id: item.sage_id, entity: entityType });
          } else {
            queueService.incrementAttempts(item.id, err.message);
          }
        }
      }
    }
    } finally {
      locks.queue = false;
    }
  });

  // Healthcheck
  cron.schedule(`*/${config.sync.healthcheckInterval} * * * * *`, async () => {
    await healthService.checkAll();
  });

  // Evaluation des alertes
  cron.schedule(`*/${config.alerts.checkInterval} * * * * *`, () => {
    alertService.evaluate();
  });

  // Mise a jour metriques queue
  cron.schedule('*/15 * * * * *', () => {
    metricsService.refreshQueueMetrics();
  });

  // Nettoyage logs sync (quotidien a 3h)
  cron.schedule('0 3 * * *', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const db = require('../config/sqlite');
    db.prepare('DELETE FROM alert_history WHERE created_at < ?').run(thirtyDaysAgo);
    queueService.purgeDone();
    appLogger.info('Cron: nettoyage quotidien effectue');
  });

  appLogger.info('Cron jobs demarres');
}

module.exports = { start };
