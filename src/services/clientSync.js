const { getPool } = require('../config/database');
const { mapClient } = require('../utils/mapper');

const COMMERCIAL_FILTER = `CT_Type = 0 AND UPPER(LTRIM(RTRIM(CT_Commentaire))) = 'COMMERCIAL'`;

const SELECT_COLS = `
  CT_Num, CT_Intitule, CT_Type,
  CG_NumPrinc, cbCG_NumPrinc,
  CT_Classement, CT_Contact, CT_Complement, CT_Ville, CT_Telephone,
  cbModification
`;

async function getChangedClients(since) {
  const pool = await getPool();
  const result = await pool.request()
    .input('lastSync', since)
    .query(`
      SELECT ${SELECT_COLS}
      FROM F_COMPTET
      WHERE ${COMMERCIAL_FILTER} AND cbModification > @lastSync
      ORDER BY cbModification ASC
    `);
  return result.recordset.map(mapClient);
}

async function getAllClientIds() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT CT_Num FROM F_COMPTET WHERE ${COMMERCIAL_FILTER}
  `);
  return result.recordset.map(row => row.CT_Num);
}

async function getClientsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const pool = await getPool();
  const request = pool.request();
  ids.forEach((id, i) => request.input(`id${i}`, id));
  const placeholders = ids.map((_, i) => `@id${i}`).join(',');
  const result = await request.query(`
    SELECT ${SELECT_COLS}
    FROM F_COMPTET
    WHERE ${COMMERCIAL_FILTER} AND CT_Num IN (${placeholders})
  `);
  return result.recordset.map(mapClient);
}

module.exports = { getChangedClients, getAllClientIds, getClientsByIds, COMMERCIAL_FILTER };
