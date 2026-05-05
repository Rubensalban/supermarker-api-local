const axios = require('axios');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const config = require('./env');
const { syncLogger } = require('../utils/logger');

// Keep-alive : evite le handshake TCP/TLS a chaque batch (gain reel sur reseau lent)
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10, keepAliveMsecs: 30000 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10, keepAliveMsecs: 30000 });

const client = axios.create({
  baseURL: config.vps.url,
  timeout: config.vps.timeout,
  httpAgent,
  httpsAgent,
  // Accepter les reponses gzip du VPS (axios decompresse automatiquement)
  decompress: true,
  headers: {
    'Content-Type': 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'x-api-key': config.vps.apiKey,
  },
  // Limites de taille pour eviter les surprises sur reseau lent
  maxContentLength: 50 * 1024 * 1024,
  maxBodyLength: 50 * 1024 * 1024,
});

// --- Circuit breaker simple ---
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function isCircuitOpen() {
  return Date.now() < circuitOpenUntil;
}

function recordSuccess() {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

function recordFailure() {
  consecutiveFailures++;
  if (consecutiveFailures >= config.circuitBreaker.threshold) {
    circuitOpenUntil = Date.now() + config.circuitBreaker.cooldown * 1000;
    syncLogger.warn('Circuit breaker OUVERT — VPS marque inaccessible', {
      cooldownSec: config.circuitBreaker.cooldown,
      failures: consecutiveFailures,
    });
  }
}

// --- Compression gzip du body si > 1KB (gain net sur reseau lent) ---
client.interceptors.request.use((req) => {
  if (req.data && typeof req.data === 'object') {
    const json = JSON.stringify(req.data);

    // HMAC : signer le body brut AVANT compression
    if (config.vps.hmacEnabled && config.vps.hmacSecret) {
      const signature = crypto
        .createHmac('sha256', config.vps.hmacSecret)
        .update(json)
        .digest('hex');
      req.headers['x-signature'] = signature;
    }

    // Compresser si payload >= 1KB
    if (Buffer.byteLength(json, 'utf8') >= 1024) {
      req.data = zlib.gzipSync(json);
      req.headers['Content-Encoding'] = 'gzip';
      req.headers['Content-Type'] = 'application/json';
    } else {
      req.data = json;
    }
  }
  return req;
});

// --- Retry avec backoff exponentiel sur erreurs reseau / 5xx / timeout ---
function isRetryable(err) {
  if (!err.response) return true; // network error, timeout, ECONNRESET...
  const status = err.response.status;
  return status >= 500 || status === 408 || status === 429;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function requestWithRetry(method, url, data, options = {}) {
  if (isCircuitOpen()) {
    const err = new Error('Circuit breaker open — VPS unreachable');
    err.code = 'CIRCUIT_OPEN';
    throw err;
  }

  const max = config.vps.retryMax;
  const base = config.vps.retryBaseDelay;
  let lastErr;

  for (let attempt = 0; attempt <= max; attempt++) {
    try {
      const response = await client.request({ method, url, data, ...options });
      recordSuccess();
      return response;
    } catch (err) {
      lastErr = err;

      if (!isRetryable(err) || attempt === max) {
        recordFailure();
        throw err;
      }

      const delay = base * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
      syncLogger.warn('Retry VPS', {
        attempt: attempt + 1,
        max,
        delayMs: delay,
        error: err.message,
      });
      await sleep(delay);
    }
  }
  throw lastErr;
}

module.exports = {
  post: (url, data, options) => requestWithRetry('post', url, data, options),
  get: (url, options) => requestWithRetry('get', url, null, options),
  isCircuitOpen,
  raw: client,
};
