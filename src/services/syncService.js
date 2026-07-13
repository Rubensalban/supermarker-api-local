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
const reglementImputationSync = require('./reglementImputationSync');

const entityConfig = {
  client: {
    getChanged: clientSync.getChangedClients,
    getChangedPage: clientSync.getChangedClientsPage,
    getAllIds: clientSync.getAllClientIds,
    getByIds: clientSync.getClientsByIds,
  },
  article: {
    getChanged: articleSync.getChangedArticles,
    // Pas de getChangedPage : le set éligible est déjà filtré en RAM via cache.
    getAllIds: articleSync.getAllArticleIds,
  },
  facture: {
    getChanged: factureSync.getChangedFactures,
    getChangedPage: factureSync.getChangedFacturesPage,
    getAllIds: factureSync.getAllFactureIds,
  },
  reglement: {
    getChanged: reglementSync.getChangedReglements,
    getChangedPage: reglementSync.getChangedReglementsPage,
    getAllIds: reglementSync.getAllReglementIds,
  },
  // Imputations placees apres reglement : l'ordre des entites est conserve
  // par Object.keys, donc syncAllIncremental traite reglement avant les
  // imputations — coherent avec la dependance metier (FK logique rg_no).
  reglement_imputation: {
    getChanged: reglementImputationSync.getChangedReglementImputations,
    getChangedPage: reglementImputationSync.getChangedReglementImputationsPage,
    getAllIds: reglementImputationSync.getAllReglementImputationIds,
  },
};

// Verrou par entité : garantit qu'une même entité n'est jamais synchronisée
// par deux cycles à la fois (ex : le cron full démarre alors que l'incrémental
// de la même entité n'a pas fini). Les locks globaux du cronService protègent
// contre le chevauchement de cycles ; celui-ci protège l'entité elle-même
// contre un full + incremental simultanés (crons indépendants).
const entityLocks = new Set();

function acquireEntityLock(entityType) {
  if (entityLocks.has(entityType)) return false;
  entityLocks.add(entityType);
  return true;
}

function releaseEntityLock(entityType) {
  entityLocks.delete(entityType);
}

// Découpe un tableau en chunks de taille `size`.
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Envoie un lot de records par batches vers l'API-ONLINE, avec re-queue des
// non-confirmés. Retourne le nombre total confirmé. Utilisé par la lecture
// paginée (full + incremental).
async function sendRecords(entityType, records) {
  let confirmedTotal = 0;
  for (let i = 0; i < records.length; i += config.vps.batchSize) {
    const batch = records.slice(i, i + config.vps.batchSize);
    try {
      const ack = await vpsService.sendBatch(entityType, 'UPSERT', batch);
      metrics.syncRecordsProcessedTotal.inc({ entity: entityType, operation: 'UPSERT' }, batch.length);

      const confirmed = new Set(Array.isArray(ack && ack.processed_sage_ids) ? ack.processed_sage_ids : []);
      const missing = batch.filter(r => !confirmed.has(r.sage_id));
      confirmedTotal += (batch.length - missing.length);
      if (missing.length > 0) {
        syncLogger.warn('Records non confirmes par API-VPS, re-queue', {
          entity: entityType,
          sent: batch.length,
          confirmed: confirmed.size,
          missing: missing.length,
          missing_ids: missing.map(r => r.sage_id).slice(0, 20),
        });
        for (const record of missing) {
          queueService.enqueue(entityType, 'UPSERT', record.sage_id, record);
        }
      }
    } catch {
      // VPS devenu inaccessible : mettre le reste de CE lot en queue et signaler.
      for (const record of records.slice(i)) {
        queueService.enqueue(entityType, 'UPSERT', record.sage_id, record);
      }
      throw new Error('vps_unreachable_during_send');
    }
  }
  return confirmedTotal;
}

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

  // Verrou par entité : si un full de la même entité est en cours, on saute
  // ce tick incrémental (il repassera au prochain cycle).
  if (!acquireEntityLock(entityType)) {
    syncLogger.warn('Sync incrementale ignoree : entite deja verrouillee', { entity: entityType });
    return { entity: entityType, skipped: true, reason: 'entity_locked' };
  }

  const meta = getMeta.get(entityType);
  // Borne basse : SYNC_START_DATE (si définie) prime sur 1970 au tout premier run.
  // Une fois que last_sync_at est posé, il prend le dessus.
  const startFloor = config.sync.startDate
    ? new Date(config.sync.startDate).toISOString()
    : '1970-01-01T00:00:00.000Z';
  const since = meta.last_sync_at || startFloor;

  const timer = metrics.syncCycleDuration.startTimer({ entity: entityType, type: 'incremental' });

  try {
    const vpsUp = healthService.isVpsUp();
    const pageSize = config.sync.readPageSize;
    let totalRead = 0;

    if (conf.getChangedPage) {
      // ─── Lecture paginée (streaming) : on lit Sage par fenêtres et on envoie
      // au fil de l'eau. Le pic mémoire est borné à une page, pas au delta total.
      // Ordre stable garanti par les getChangedPage (cbModification + clé).
      let offset = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page = await conf.getChangedPage(since, offset, pageSize);
        if (page.length === 0) break;
        totalRead += page.length;

        if (vpsUp) {
          try {
            await sendRecords(entityType, page);
          } catch {
            // VPS tombé pendant l'envoi : sendRecords a déjà mis le reste de la
            // page en queue. On enfile aussi les pages suivantes non lues n'a
            // pas de sens (on ne les a pas), on arrête la lecture : le prochain
            // cycle reprendra depuis `since` (idempotent côté online).
            break;
          }
        } else {
          for (const record of page) {
            queueService.enqueue(entityType, 'UPSERT', record.sage_id, record);
          }
        }

        // Dernière page (partielle) : fin du flux.
        if (page.length < pageSize) break;
        offset += pageSize;
      }
    } else {
      // ─── Fallback non paginé (article : déjà borné par cache RAM).
      const records = await conf.getChanged(since);
      totalRead = records.length;
      if (records.length > 0) {
        if (vpsUp) {
          try {
            await sendRecords(entityType, records);
          } catch { /* reste déjà mis en queue par sendRecords */ }
        } else {
          for (const record of records) {
            queueService.enqueue(entityType, 'UPSERT', record.sage_id, record);
          }
        }
      }
    }

    updateMeta.run(new Date().toISOString(), 'SUCCESS', totalRead, entityType);
    metrics.syncCyclesTotal.inc({ entity: entityType, type: 'incremental', status: 'success' });
    metrics.syncLastSuccess.set({ entity: entityType, type: 'incremental' }, Date.now() / 1000);
    timer();

    syncLogger.info('Sync incrementale terminee', { entity: entityType, records: totalRead, queued: !vpsUp });

    return { entity: entityType, processed: totalRead };
  } catch (err) {
    timer();
    metrics.syncCyclesTotal.inc({ entity: entityType, type: 'incremental', status: 'failure' });
    metrics.syncErrorsTotal.inc({ entity: entityType, error_type: 'sync_incremental' });
    updateMeta.run(new Date().toISOString(), 'FAILED', 0, entityType);

    syncLogger.error('Echec sync incrementale', { entity: entityType, error: err.message });
    throw err;
  } finally {
    releaseEntityLock(entityType);
  }
}

/**
 * Sync complete (detection des suppressions) pour une entite.
 */
async function syncFull(entityType) {
  if (paused) return { skipped: true, reason: 'paused' };

  const conf = entityConfig[entityType];
  if (!conf) throw new Error(`Entite inconnue : ${entityType}`);

  // Verrou par entité : ne pas lancer un full si un incrémental (ou un autre
  // full) de la même entité tourne — évite les envois croisés / la double charge.
  if (!acquireEntityLock(entityType)) {
    syncLogger.warn('Sync full ignoree : entite deja verrouillee', { entity: entityType });
    return { entity: entityType, skipped: true, reason: 'entity_locked' };
  }

  const timer = metrics.syncCycleDuration.startTimer({ entity: entityType, type: 'full' });

  try {
    const allIds = await conf.getAllIds();
    const vpsUp = healthService.isVpsUp();

    if (vpsUp) {
      // ─── Détection des suppressions par chunks : un seul POST avec des
      // milliers d'IDs génère un WHERE NOT IN (...) massif côté PostgreSQL
      // (lent, risque de timeout). On découpe en lots deletionsChunkSize.
      // NB : chaque chunk est une liste PARTIELLE d'IDs actifs — l'API-ONLINE
      // doit donc traiter les deletions en mode "réconciliation par lot"
      // (voir syncController.receiveDeletions) et non en "tout ce qui n'est pas
      // dans ce lot est supprimé".
      const deletionChunks = chunk(allIds, config.sync.deletionsChunkSize);
      const totalChunks = deletionChunks.length || 1;
      for (let idx = 0; idx < deletionChunks.length; idx++) {
        await vpsService.sendDeletions(entityType, deletionChunks[idx], {
          chunkIndex: idx,
          chunkTotal: totalChunks,
          allIdsCount: allIds.length,
        });
      }
      // Cas liste vide : signaler explicitement (0 actif => tout soft-delete).
      if (deletionChunks.length === 0) {
        await vpsService.sendDeletions(entityType, [], {
          chunkIndex: 0, chunkTotal: 1, allIdsCount: 0,
        });
      }

      // Reconciliation : detecter les sage_ids actifs en Sage mais absents
      // (ou is_deleted=true) cote online (suppression manuelle, restore
      // qui n'a rien retrouve). Ne s'applique qu'aux entites avec getByIds.
      // Le /check est aussi chunké pour ne pas envoyer des milliers d'IDs.
      if (conf.getByIds && allIds.length > 0) {
        try {
          const missing = [];
          for (const idsChunk of chunk(allIds, config.sync.deletionsChunkSize)) {
            const check = await vpsService.checkPresence(entityType, idsChunk);
            missing.push(...((check && check.missing_sage_ids) || []));
          }
          if (missing.length > 0) {
            syncLogger.warn('Reconciliation : sage_ids manquants online, re-upsert', {
              entity: entityType, missing: missing.length, sample: missing.slice(0, 10),
            });
            // Re-upsert par lots de récupération pour borner la RAM.
            for (const missingChunk of chunk(missing, config.sync.readPageSize)) {
              const records = await conf.getByIds(missingChunk);
              try {
                await sendRecords(entityType, records);
              } catch {
                // reste déjà mis en queue par sendRecords
                break;
              }
            }
          }
        } catch (err) {
          syncLogger.error('Reconciliation echouee', { entity: entityType, error: err.message });
        }
      }
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
  } finally {
    releaseEntityLock(entityType);
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
