const syncService = require('../services/syncService');

async function syncEntity(req, res, next) {
  try {
    const { entity } = req.params;
    const result = await syncService.syncIncremental(entity);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function syncAll(req, res, next) {
  try {
    const results = await syncService.syncAllIncremental();
    res.json({ results });
  } catch (err) {
    next(err);
  }
}

async function syncFull(req, res, next) {
  try {
    const results = await syncService.syncAllFull();
    res.json({ results });
  } catch (err) {
    next(err);
  }
}

function pause(req, res) {
  syncService.setPaused(true);
  res.json({ status: 'paused' });
}

function resume(req, res) {
  syncService.setPaused(false);
  res.json({ status: 'resumed' });
}

function getLogs(req, res) {
  const metadata = syncService.getMetadata();
  res.json({ metadata });
}

module.exports = { syncEntity, syncAll, syncFull, pause, resume, getLogs };
