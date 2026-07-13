const { getPool } = require('../config/database');
const config = require('../config/env');
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

// Lecture paginée pour la sync full de masse : une fenêtre stable ordonnée par
// (cbModification, CT_Num) via OFFSET/FETCH. Évite de charger tous les clients
// en RAM. Retourne [] quand la page est vide (fin de flux).
async function getChangedClientsPage(since, offset, limit) {
  const pool = await getPool();
  const result = await pool.request()
    .input('lastSync', since)
    .input('offset', offset)
    .input('limit', limit)
    .query(`
      SELECT ${SELECT_COLS}
      FROM F_COMPTET
      WHERE ${COMMERCIAL_FILTER} AND cbModification > @lastSync
      ORDER BY cbModification ASC, CT_Num ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
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

module.exports = { getChangedClients, getChangedClientsPage, getAllClientIds, getClientsByIds, COMMERCIAL_FILTER };
