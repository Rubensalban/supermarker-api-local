const { appLogger } = require('../utils/logger');

function errorHandler(err, req, res, _next) {
  appLogger.error('Erreur non geree', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
  });

  const status = err.status || 500;
  res.status(status).json({
    error: status === 500 ? 'Erreur interne du serveur' : err.message,
  });
}

module.exports = errorHandler;
