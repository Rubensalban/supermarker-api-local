const db = require('../config/sqlite');
const metrics = require('../config/prometheus');
const { syncLogger } = require('../utils/logger');

const stmts = {
  enqueue: db.prepare(`
    INSERT INTO sync_queue (entity_type, operation, sage_id, payload)
    VALUES (?, ?, ?, ?)
  `),

  dedup: db.prepare(`
    DELETE FROM sync_queue
    WHERE sage_id = ? AND entity_type = ? AND status = 'PENDING' AND id != ?
  `),

  getPending: db.prepare(`
    SELECT * FROM sync_queue
    WHERE status = 'PENDING'
    ORDER BY created_at ASC
    LIMIT ?
  `),

  markProcessing: db.prepare(`
    UPDATE sync_queue SET status = 'PROCESSING' WHERE id = ?
  `),

  markDone: db.prepare(`
    UPDATE sync_queue SET status = 'DONE', processed_at = datetime('now') WHERE id = ?
  `),

  markFailed: db.prepare(`
    UPDATE sync_queue SET status = 'FAILED', error = ?, processed_at = datetime('now') WHERE id = ?
  `),

  incrementAttempts: db.prepare(`
    UPDATE sync_queue SET attempts = attempts + 1, error = ?, status = 'PENDING' WHERE id = ?
  `),

  countByStatus: db.prepare(`
    SELECT status, COUNT(*) as count FROM sync_queue GROUP BY status
  `),

  oldestPending: db.prepare(`
    SELECT created_at FROM sync_queue WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 1
  `),

  purgeDone: db.prepare(`
    DELETE FROM sync_queue WHERE status = 'DONE'
  `),

  retryFailed: db.prepare(`
    UPDATE sync_queue SET status = 'PENDING', attempts = 0, error = NULL WHERE status = 'FAILED'
  `),

  // Reset des items restes PROCESSING : utilise au demarrage uniquement
  // (le process precedent a ete tue avant de pouvoir marquer DONE/FAILED).
  resetProcessing: db.prepare(`
    UPDATE sync_queue SET status = 'PENDING' WHERE status = 'PROCESSING'
  `),

  getAll: db.prepare(`
    SELECT * FROM sync_queue WHERE status IN ('PENDING', 'FAILED') ORDER BY created_at ASC
  `),
};

function enqueue(entityType, operation, sageId, payload) {
  const result = stmts.enqueue.run(entityType, operation, sageId, JSON.stringify(payload));
  // Deduplication : ne garder que le dernier pour ce sage_id
  stmts.dedup.run(sageId, entityType, result.lastInsertRowid);
  return result.lastInsertRowid;
}

function getPending(limit = 100) {
  return stmts.getPending.all(limit);
}

function markProcessing(id) {
  stmts.markProcessing.run(id);
}

function markDone(id) {
  stmts.markDone.run(id);
  metrics.queueProcessedTotal.inc({ status: 'DONE' });
}

function markFailed(id, error) {
  stmts.markFailed.run(error, id);
  metrics.queueProcessedTotal.inc({ status: 'FAILED' });
}

function incrementAttempts(id, error) {
  stmts.incrementAttempts.run(error, id);
}

function getStats() {
  const rows = stmts.countByStatus.all();
  const stats = {};
  for (const row of rows) {
    stats[row.status] = row.count;
  }
  return stats;
}

function getOldestPendingAge() {
  const row = stmts.oldestPending.get();
  if (!row) return 0;
  const created = new Date(row.created_at + 'Z').getTime();
  return (Date.now() - created) / 1000;
}

function updateMetrics() {
  const stats = getStats();
  for (const status of ['PENDING', 'PROCESSING', 'DONE', 'FAILED']) {
    metrics.queueSize.set({ status }, stats[status] || 0);
  }
  metrics.queueOldestPending.set(getOldestPendingAge());
}

function purgeDone() {
  const result = stmts.purgeDone.run();
  return result.changes;
}

function retryFailed() {
  const result = stmts.retryFailed.run();
  return result.changes;
}

// Au demarrage : tout item bloque en PROCESSING est issu d'un crash du
// process precedent. On le repasse en PENDING pour qu'il soit retente.
function resetStaleProcessing() {
  const result = stmts.resetProcessing.run();
  return result.changes;
}

function getAll() {
  return stmts.getAll.all();
}

module.exports = {
  enqueue,
  getPending,
  markProcessing,
  markDone,
  markFailed,
  incrementAttempts,
  getStats,
  getOldestPendingAge,
  updateMetrics,
  purgeDone,
  retryFailed,
  resetStaleProcessing,
  getAll,
};
