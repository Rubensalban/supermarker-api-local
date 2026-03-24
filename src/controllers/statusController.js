const healthService = require('../services/healthService');
const syncService = require('../services/syncService');
const queueService = require('../services/queueService');

async function getStatus(req, res) {
  const connections = await healthService.checkAll();
  const metadata = syncService.getMetadata();
  const queueStats = queueService.getStats();

  res.json({
    status: 'running',
    paused: syncService.isPaused(),
    connections,
    lastSync: metadata,
    queue: queueStats,
  });
}

async function getConnections(req, res) {
  const connections = await healthService.checkAll();
  res.json(connections);
}

function getQueueStatus(req, res) {
  const stats = queueService.getStats();
  const oldestAge = queueService.getOldestPendingAge();
  res.json({ ...stats, oldest_pending_seconds: oldestAge });
}

module.exports = { getStatus, getConnections, getQueueStatus };
