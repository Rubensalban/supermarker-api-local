const db = require('../config/sqlite');
const config = require('../config/env');
const metrics = require('../config/prometheus');
const { syncLogger } = require('../utils/logger');
const vpsService = require('./vpsService');
const queueService = require('./queueService');
const healthService = require('./healthService');
const clientSync = require('./clientSync');
const articleSync = require('./articleSync');
const factureSync = require('./factureSync');
const reglementSync = require('./reglementSync');

const entityConfig = {
  client: {
    getChanged: clientSync.getChangedClients,
    getAllIds: clientSync.getAllClientIds,
  },
  article: {
    getChanged: articleSync.getChangedArticles,
    getAllIds: articleSync.getAllArticleIds,
  },
  facture: {
    getChanged: factureSync.getChangedFactures,
    getAllIds: factureSync.getAllFactureIds,
  },
  reglement: {
    getChanged: reglementSync.getChangedReglements,
    getAllIds: reglementSync.getAllReglementIds,
  },
};

const getMeta = db.prepare('SELECT * FROM sync_metadata WHERE entity_type = ?');
const updateMeta = db.prepare(`
  UPDATE sync_metadata
  SET last_sync_at = ?, last_sync_status = ?, records_synced = ?
  WHERE entity_type = ?
`);
const updateFullMeta = db.prepare(`
  UPDATE sync_metadata SET last_full_sync_at = ? WHERE entity_type = ?
`);

let paused = false;

function isPaused() {
  return paused;
}

function setPaused(value) {
  paused = value;
  syncLogger.info(`Sync ${value ? 'mise en pause' : 'reprise'}`);
}

/**
 * Sync incrementale pour une entite donnee.
 */
async function syncIncremental(entityType) {
  if (paused) return { skipped: true, reason: 'paused' };

  const conf = entityConfig[entityType];
  if (!conf) throw new Error(`Entite inconnue : ${entityType}`);

  const meta = getMeta.get(entityType);
  const since = meta.last_sync_at || '1970-01-01T00:00:00.000Z';

  const timer = metrics.syncCycleDuration.startTimer({ entity: entityType, type: 'incremental' });

  try {
    const records = await conf.getChanged(since);

    if (records.length === 0) {
      timer();
      metrics.syncCyclesTotal.inc({ entity: entityType, type: 'incremental', status: 'success' });
      return { entity: entityType, processed: 0 };
    }

    const vpsUp = healthService.isVpsUp();

    if (vpsUp) {
      // Envoyer par batch
      for (let i = 0; i < records.length; i += config.vps.batchSize) {
        const batch = records.slice(i, i + config.vps.batchSize);
        try {
          await vpsService.sendBatch(entityType, 'UPSERT', batch);
          metrics.syncRecordsProcessedTotal.inc({ entity: entityType, operation: 'UPSERT' }, batch.length);
        } catch {
          // VPS devenu inaccessible, mettre le reste en queue
          for (const record of records.slice(i)) {
            queueService.enqueue(entityType, 'UPSERT', record.sage_id, record);
          }
          break;
        }
      }
    } else {
      // Mettre tout en queue
      for (const record of records) {
        queueService.enqueue(entityType, 'UPSERT', record.sage_id, record);
      }
    }

    updateMeta.run(new Date().toISOString(), 'SUCCESS', records.length, entityType);
    metrics.syncCyclesTotal.inc({ entity: entityType, type: 'incremental', status: 'success' });
    metrics.syncLastSuccess.set({ entity: entityType, type: 'incremental' }, Date.now() / 1000);
    timer();

    syncLogger.info('Sync incrementale terminee', { entity: entityType, records: records.length, queued: !vpsUp });

    return { entity: entityType, processed: records.length };
  } catch (err) {
    timer();
    metrics.syncCyclesTotal.inc({ entity: entityType, type: 'incremental', status: 'failure' });
    metrics.syncErrorsTotal.inc({ entity: entityType, error_type: 'sync_incremental' });
    updateMeta.run(new Date().toISOString(), 'FAILED', 0, entityType);

    syncLogger.error('Echec sync incrementale', { entity: entityType, error: err.message });
    throw err;
  }
}

/**
 * Sync complete (detection des suppressions) pour une entite.
 */
async function syncFull(entityType) {
  if (paused) return { skipped: true, reason: 'paused' };

  const conf = entityConfig[entityType];
  if (!conf) throw new Error(`Entite inconnue : ${entityType}`);

  const timer = metrics.syncCycleDuration.startTimer({ entity: entityType, type: 'full' });

  try {
    const allIds = await conf.getAllIds();
    const vpsUp = healthService.isVpsUp();

    if (vpsUp) {
      await vpsService.sendDeletions(entityType, allIds);
    } else {
      syncLogger.warn('Sync full reportee : API-VPS inaccessible', { entity: entityType });
      timer();
      return { entity: entityType, skipped: true, reason: 'vps_down' };
    }

    updateFullMeta.run(new Date().toISOString(), entityType);
    metrics.syncCyclesTotal.inc({ entity: entityType, type: 'full', status: 'success' });
    metrics.syncLastSuccess.set({ entity: entityType, type: 'full' }, Date.now() / 1000);
    timer();

    syncLogger.info('Sync full terminee', { entity: entityType, activeIds: allIds.length });

    return { entity: entityType, activeIds: allIds.length };
  } catch (err) {
    timer();
    metrics.syncCyclesTotal.inc({ entity: entityType, type: 'full', status: 'failure' });
    metrics.syncErrorsTotal.inc({ entity: entityType, error_type: 'sync_full' });

    syncLogger.error('Echec sync full', { entity: entityType, error: err.message });
    throw err;
  }
}

/**
 * Sync incrementale de toutes les entites.
 */
async function syncAllIncremental() {
  const results = [];
  for (const entityType of Object.keys(entityConfig)) {
    try {
      results.push(await syncIncremental(entityType));
    } catch (err) {
      results.push({ entity: entityType, error: err.message });
    }
  }
  return results;
}

/**
 * Sync complete de toutes les entites.
 */
async function syncAllFull() {
  const results = [];
  for (const entityType of Object.keys(entityConfig)) {
    try {
      results.push(await syncFull(entityType));
    } catch (err) {
      results.push({ entity: entityType, error: err.message });
    }
  }
  return results;
}

function getMetadata() {
  return db.prepare('SELECT * FROM sync_metadata').all();
}

module.exports = {
  syncIncremental,
  syncFull,
  syncAllIncremental,
  syncAllFull,
  getMetadata,
  isPaused,
  setPaused,
};
