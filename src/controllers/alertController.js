const alertService = require('../services/alertService');

function getActive(req, res) {
  const alerts = alertService.getActiveAlerts();
  res.json({ count: alerts.length, alerts });
}

function getHistory(req, res) {
  const limit = parseInt(req.query.limit, 10) || 50;
  const offset = parseInt(req.query.offset, 10) || 0;
  const alerts = alertService.getAlertHistory(limit, offset);
  res.json({ alerts });
}

function acknowledge(req, res) {
  const { id } = req.params;
  alertService.acknowledgeAlert(id);
  res.json({ acknowledged: true });
}

module.exports = { getActive, getHistory, acknowledge };
