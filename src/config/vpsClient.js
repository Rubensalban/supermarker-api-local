const axios = require('axios');
const crypto = require('crypto');
const config = require('./env');

const client = axios.create({
  baseURL: config.vps.url,
  timeout: config.vps.timeout,
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': config.vps.apiKey,
  },
});

client.interceptors.request.use((req) => {
  if (config.vps.hmacEnabled && config.vps.hmacSecret && req.data) {
    const body = typeof req.data === 'string' ? req.data : JSON.stringify(req.data);
    const signature = crypto
      .createHmac('sha256', config.vps.hmacSecret)
      .update(body)
      .digest('hex');
    req.headers['x-signature'] = signature;
  }
  return req;
});

module.exports = client;
