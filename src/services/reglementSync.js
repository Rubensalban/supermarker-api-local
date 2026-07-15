const sql = require('mssql');
const { getPool } = require('../config/database');
const config = require('../config/env');
const { mapReglement } = require('../utils/mapper');

const COMMERCIAL_PAYEUR_SUBQUERY = `
  CT_NumPayeur IN (
    SELECT CT_Num FROM F_COMPTET
    WHERE CT_Type = 0 AND UPPER(LTRIM(RTRIM(CT_Commentaire))) = 'COMMERCIAL'
  )
`;

const startDateClause = () => (config.sync.startDate ? 'AND RG_Date >= @startDate' : '');

async function getChangedReglements(since) {
  const pool = await getPool();
  const req = pool.request().input('lastSync', since);
  if (config.sync.startDate) req.input('startDate', config.sync.startDate);
  const result = await req.query(`
      SELECT RG_No, CT_NumPayeur, RG_Date, RG_Reference, RG_Libelle,
             RG_Montant, RG_MontantDev, N_Reglement, RG_Impute, RG_Compta,
             RG_TypeReg, cbModification
      FROM F_CREGLEMENT
      WHERE ${COMMERCIAL_PAYEUR_SUBQUERY}
        AND cbModification > @lastSync
        ${startDateClause()}
      ORDER BY cbModification ASC
    `);
  return result.recordset.map(mapReglement);
}

// Lecture paginée des règlements pour la sync full de masse.
// Ordre stable (cbModification, RG_No) via OFFSET/FETCH.
async function getChangedReglementsPage(since, offset, limit) {
  const pool = await getPool();
  const req = pool.request()
    .input('lastSync', since)
    .input('offset', sql.Int, offset)
    .input('limit', sql.Int, limit);
  if (config.sync.startDate) req.input('startDate', config.sync.startDate);
  const result = await req.query(`
      SELECT RG_No, CT_NumPayeur, RG_Date, RG_Reference, RG_Libelle,
             RG_Montant, RG_MontantDev, N_Reglement, RG_Impute, RG_Compta,
             RG_TypeReg, cbModification
      FROM F_CREGLEMENT
      WHERE ${COMMERCIAL_PAYEUR_SUBQUERY}
        AND cbModification > @lastSync
        ${startDateClause()}
      ORDER BY cbModification ASC, RG_No ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);
  return result.recordset.map(mapReglement);
}

async function getAllReglementIds() {
  const pool = await getPool();
  const req = pool.request();
  if (config.sync.startDate) req.input('startDate', config.sync.startDate);
  const result = await req.query(`
    SELECT RG_No FROM F_CREGLEMENT
    WHERE ${COMMERCIAL_PAYEUR_SUBQUERY}
      ${startDateClause()}
  `);
  return result.recordset.map(row => String(row.RG_No));
}

// Récupère les règlements par leurs RG_No (sage_id). Utilisé par la
// réconciliation du full sync pour re-créer côté online les règlements
// manquants. Les ids sont des chaînes ("RG_No").
async function getReglementsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const pool = await getPool();
  const request = pool.request();
  ids.forEach((id, i) => request.input(`id${i}`, sql.Int, parseInt(id, 10)));
  const placeholders = ids.map((_, i) => `@id${i}`).join(',');
  const result = await request.query(`
    SELECT RG_No, CT_NumPayeur, RG_Date, RG_Reference, RG_Libelle,
           RG_Montant, RG_MontantDev, N_Reglement, RG_Impute, RG_Compta,
           RG_TypeReg, cbModification
    FROM F_CREGLEMENT
    WHERE RG_No IN (${placeholders})
  `);
  return result.recordset.map(mapReglement);
}

module.exports = { getChangedReglements, getChangedReglementsPage, getAllReglementIds, getReglementsByIds };
