const { getPool } = require('../config/database');
const config = require('../config/env');
const { syncLogger } = require('../utils/logger');
const syncService = require('./syncService');
const healthService = require('./healthService');

const TABLE_TO_ENTITIES = {
  F_COMPTET:    ['client'],
  F_ARTICLE:    ['article'],
  F_DOCENTETE:  ['facture'],
  F_DOCLIGNE:   ['facture'],
  F_CREGLEMENT: ['reglement', 'reglement_imputation'],
  F_REGLECH:    ['reglement_imputation'],
  F_ECRITUREC:  ['ecriture'],
};

const ENTITY_ORDER = ['client', 'article', 'facture', 'reglement', 'reglement_imputation', 'ecriture'];

const WATCHED_TABLES = Object.keys(TABLE_TO_ENTITIES);

// Instantané { table: last_user_update (ms epoch) } du tick précédent.
let snapshot = null;
let running = false;
let timer = null;
let consecutiveErrors = 0;

async function readLastUpdates() {
  const pool = await getPool();
  const tablesList = WATCHED_TABLES.map(t => `'${t}'`).join(',');
  const result = await pool.request().query(`
    SELECT t.name AS table_name, MAX(s.last_user_update) AS last_update
    FROM sys.dm_db_index_usage_stats s
    INNER JOIN sys.tables t ON t.object_id = s.object_id
    WHERE s.database_id = DB_ID()
      AND t.name IN (${tablesList})
      AND s.last_user_update IS NOT NULL
    GROUP BY t.name
  `);
  const map = {};
  for (const row of result.recordset) {
    map[row.table_name] = new Date(row.last_update).getTime();
  }
  return map;
}

async function tick() {
  if (running) return; // un tick long (sync en cours) : on saute, le suivant rattrapera
  if (syncService.isPaused()) return;
  if (!healthService.isSqlServerUp()) return;

  running = true;
  try {
    const current = await readLastUpdates();
    consecutiveErrors = 0;

    // Premier passage (ou après reset) : instantané seulement, pas de sync.
    if (snapshot === null) {
      snapshot = current;
      syncLogger.info('ChangeWatcher: instantané initial pris', { tables: Object.keys(current).length });
      return;
    }

    // Tables modifiées depuis le dernier tick -> entités à synchroniser.
    const entities = new Set();
    for (const table of WATCHED_TABLES) {
      const prev = snapshot[table];
      const now = current[table];
      if (now !== undefined && now !== prev) {
        for (const e of TABLE_TO_ENTITIES[table]) entities.add(e);
      }
    }
    snapshot = current;

    if (entities.size === 0) return;

    const ordered = ENTITY_ORDER.filter(e => entities.has(e));
    syncLogger.info('ChangeWatcher: modification détectée, sync déclenchée', { entities: ordered });

    for (const entity of ordered) {
      try {
        await syncService.syncIncremental(entity);
      } catch (err) {
        // Déjà loggé/compté par syncService ; le cron de secours repassera.
        syncLogger.warn('ChangeWatcher: sync déclenchée en échec', { entity: entity, error: err.message });
      }
    }
  } catch (err) {
    consecutiveErrors += 1;
    if (consecutiveErrors === 1 || consecutiveErrors % 30 === 0) {
      syncLogger.error('ChangeWatcher: lecture DMV en échec', {
        error: err.message, consecutive: consecutiveErrors,
      });
    }
    snapshot = null;
  } finally {
    running = false;
  }
}

function start() {
  if (!config.sync.watchEnabled) {
    syncLogger.info('ChangeWatcher: désactivé (SYNC_WATCH_ENABLED=false)');
    return;
  }
  const intervalMs = Math.max(2, config.sync.watchInterval) * 1000;
  timer = setInterval(tick, intervalMs);
  timer.unref();
  syncLogger.info('ChangeWatcher: démarré', { intervalSeconds: intervalMs / 1000 });
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop };
