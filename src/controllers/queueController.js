const queueService = require('../services/queueService');

function getQueue(req, res) {
  const items = queueService.getAll();
  res.json({ count: items.length, items });
}

function retryFailed(req, res) {
  const count = queueService.retryFailed();
  res.json({ retried: count });
}

function purgeDone(req, res) {
  const count = queueService.purgeDone();
  res.json({ purged: count });
}

module.exports = { getQueue, retryFailed, purgeDone };
