const queueService = require('./queueService');

/**
 * Met a jour toutes les metriques de la queue.
 * Appele periodiquement par le cron.
 */
function refreshQueueMetrics() {
  queueService.updateMetrics();
}

module.exports = { refreshQueueMetrics };
