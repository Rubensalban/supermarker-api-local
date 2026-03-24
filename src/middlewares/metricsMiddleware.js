const { httpRequestsTotal, httpRequestDuration } = require('../config/prometheus');

function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSec = durationNs / 1e9;

    const route = req.route ? req.route.path : req.path;
    const method = req.method;
    const status = String(res.statusCode);

    httpRequestsTotal.inc({ method, route, status });
    httpRequestDuration.observe({ method, route }, durationSec);
  });

  next();
}

module.exports = metricsMiddleware;
