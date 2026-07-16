const sql = require('mssql');
const { getPool } = require('../config/database');
const config = require('../config/env');
const { mapEcriture } = require('../utils/mapper');

// Écritures comptables (F_ECRITUREC) des comptes tiers COMMERCIAL. Elles
// servent à calculer le SOLDE COMPTABLE réel côté online (= analyse de risque
// Sage) : solde = Σ (débit − crédit). Filtre commercial identique aux autres
// entités, + borne SYNC_START_DATE sur EC_Date.
const COMMERCIAL_SUBQUERY = `
  e.CT_Num IN (
    SELECT CT_Num FROM F_COMPTET
    WHERE CT_Type = 0 AND UPPER(LTRIM(RTRIM(CT_Commentaire))) = 'COMMERCIAL'
  )
`;

const startDateClause = () => (config.sync.startDate ? 'AND e.EC_Date >= @startDate' : '');

const SELECT_COLS = `
  e.EC_No, e.CT_Num, e.EC_Date, e.JM_Date, e.EC_Sens,
  e.EC_Montant, e.EC_Lettrage, e.EC_Intitule, e.cbModification
`;

async function getChangedEcritures(since) {
  const pool = await getPool();
  const req = pool.request().input('lastSync', since);
  if (config.sync.startDate) req.input('startDate', config.sync.startDate);
  const result = await req.query(`
    SELECT ${SELECT_COLS}
    FROM F_ECRITUREC e
    WHERE ${COMMERCIAL_SUBQUERY}
      AND e.cbModification > @lastSync
      ${startDateClause()}
    ORDER BY e.cbModification ASC
  `);
  return result.recordset.map(mapEcriture);
}

// Lecture paginée pour la sync full de masse (des milliers d'écritures).
async function getChangedEcrituresPage(since, offset, limit) {
  const pool = await getPool();
  const req = pool.request()
    .input('lastSync', since)
    .input('offset', sql.Int, offset)
    .input('limit', sql.Int, limit);
  if (config.sync.startDate) req.input('startDate', config.sync.startDate);
  const result = await req.query(`
    SELECT ${SELECT_COLS}
    FROM F_ECRITUREC e
    WHERE ${COMMERCIAL_SUBQUERY}
      AND e.cbModification > @lastSync
      ${startDateClause()}
    ORDER BY e.cbModification ASC, e.EC_No ASC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `);
  return result.recordset.map(mapEcriture);
}

async function getAllEcritureIds() {
  const pool = await getPool();
  const req = pool.request();
  if (config.sync.startDate) req.input('startDate', config.sync.startDate);
  const result = await req.query(`
    SELECT e.EC_No FROM F_ECRITUREC e
    WHERE ${COMMERCIAL_SUBQUERY}
      ${startDateClause()}
  `);
  return result.recordset.map(row => String(row.EC_No));
}

// Récupère les écritures par leurs EC_No (sage_id). Utilisé par la
// réconciliation du full sync. Chunké pour rester sous la limite de paramètres.
async function getEcrituresByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const pool = await getPool();
  const CHUNK = 1000;
  const out = [];
  for (let start = 0; start < ids.length; start += CHUNK) {
    const slice = ids.slice(start, start + CHUNK);
    const request = pool.request();
    slice.forEach((id, i) => request.input(`id${i}`, sql.Int, parseInt(id, 10)));
    const placeholders = slice.map((_, i) => `@id${i}`).join(',');
    const result = await request.query(`
      SELECT ${SELECT_COLS}
      FROM F_ECRITUREC e
      WHERE e.EC_No IN (${placeholders})
    `);
    out.push(...result.recordset.map(mapEcriture));
  }
  return out;
}

module.exports = {
  getChangedEcritures,
  getChangedEcrituresPage,
  getAllEcritureIds,
  getEcrituresByIds,
};
