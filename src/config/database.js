const sql = require('mssql');
const config = require('./env');

const sqlConfig = {
  server: config.mssql.host,
  port: config.mssql.port,
  user: config.mssql.user,
  password: config.mssql.password,
  database: config.mssql.database,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    connectTimeout: 15000,
    requestTimeout: 30000,
  },
  pool: {
    max: 5,
    min: 1,
    idleTimeoutMillis: 30000,
  },
};

let pool = null;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(sqlConfig);
  }
  return pool;
}

async function closePool() {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

async function testConnection() {
  try {
    const p = await getPool();
    await p.request().query('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

module.exports = { getPool, closePool, testConnection };
