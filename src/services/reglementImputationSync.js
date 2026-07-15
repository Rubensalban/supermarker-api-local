const sql = require('mssql');
const { getPool } = require('../config/database');
const config = require('../config/env');
const { mapReglementImputation } = require('../utils/mapper');

// On reprend le meme filtre commercial que reglementSync.js : on remonte
// uniquement les imputations dont le reglement parent appartient a un
// commercial (CT_Type=0, CT_Commentaire='COMMERCIAL').
const COMMERCIAL_PAYEUR_SUBQUERY = `
  c.CT_NumPayeur IN (
    SELECT CT_Num FROM F_COMPTET
    WHERE CT_Type = 0 AND UPPER(LTRIM(RTRIM(CT_Commentaire))) = 'COMMERCIAL'
  )
`;

const startDateClause = () => (config.sync.startDate ? 'AND c.RG_Date >= @startDate' : '');

async function getChangedReglementImputations(since) {
  const pool = await getPool();
  const req = pool.request().input('lastSync', since);
  if (config.sync.startDate) req.input('startDate', config.sync.startDate);

  // F_REGLECH (rc) jointe a F_CREGLEMENT (c) : la jointure assure :
  //  - le filtre commercial (via CT_NumPayeur)
  //  - le filtre date (RG_Date),
  //  - la traçabilite de cbModification (on prend le max des deux,
  //    pour ne rien rater si seul l'un est modifie).
  const result = await req.query(`
    SELECT rc.RG_No, rc.DR_No, rc.DO_Domaine, rc.DO_Type, rc.DO_Piece,
           rc.RC_Montant, rc.RG_TypeReg,
           CASE WHEN rc.cbModification > c.cbModification
                THEN rc.cbModification ELSE c.cbModification END AS cbModification
    FROM F_REGLECH rc
    INNER JOIN F_CREGLEMENT c ON c.RG_No = rc.RG_No
    WHERE ${COMMERCIAL_PAYEUR_SUBQUERY}
      AND (rc.cbModification > @lastSync OR c.cbModification > @lastSync)
      ${startDateClause()}
    ORDER BY cbModification ASC
  `);

  return result.recordset.map(mapReglementImputation);
}

// Lecture paginée des imputations pour la sync full de masse.
// Ordre stable (cbModification, RG_No, DR_No) via OFFSET/FETCH.
async function getChangedReglementImputationsPage(since, offset, limit) {
  const pool = await getPool();
  const req = pool.request()
    .input('lastSync', since)
    .input('offset', sql.Int, offset)
    .input('limit', sql.Int, limit);
  if (config.sync.startDate) req.input('startDate', config.sync.startDate);

  const result = await req.query(`
    SELECT rc.RG_No, rc.DR_No, rc.DO_Domaine, rc.DO_Type, rc.DO_Piece,
           rc.RC_Montant, rc.RG_TypeReg,
           CASE WHEN rc.cbModification > c.cbModification
                THEN rc.cbModification ELSE c.cbModification END AS cbModification
    FROM F_REGLECH rc
    INNER JOIN F_CREGLEMENT c ON c.RG_No = rc.RG_No
    WHERE ${COMMERCIAL_PAYEUR_SUBQUERY}
      AND (rc.cbModification > @lastSync OR c.cbModification > @lastSync)
      ${startDateClause()}
    ORDER BY cbModification ASC, rc.RG_No ASC, rc.DR_No ASC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `);

  return result.recordset.map(mapReglementImputation);
}

async function getAllReglementImputationIds() {
  const pool = await getPool();
  const req = pool.request();
  if (config.sync.startDate) req.input('startDate', config.sync.startDate);

  const result = await req.query(`
    SELECT rc.RG_No, rc.DR_No FROM F_REGLECH rc
    INNER JOIN F_CREGLEMENT c ON c.RG_No = rc.RG_No
    WHERE ${COMMERCIAL_PAYEUR_SUBQUERY}
      ${startDateClause()}
  `);

  return result.recordset.map((row) => `${row.RG_No}-${row.DR_No}`);
}

// Récupère les imputations par leurs sage_id composites "{RG_No}-{DR_No}".
// Utilisé par la réconciliation du full sync. On filtre sur (RG_No, DR_No)
// via une table de valeurs, en ne gardant que les paires demandées.
async function getReglementImputationsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const pairs = ids
    .map((id) => {
      const [rg, dr] = String(id).split('-');
      return { rg: parseInt(rg, 10), dr: parseInt(dr, 10) };
    })
    .filter((p) => Number.isInteger(p.rg) && Number.isInteger(p.dr));
  if (pairs.length === 0) return [];

  const pool = await getPool();
  const request = pool.request();
  pairs.forEach((p, i) => {
    request.input(`rg${i}`, sql.Int, p.rg);
    request.input(`dr${i}`, sql.Int, p.dr);
  });
  const values = pairs.map((_, i) => `(@rg${i},@dr${i})`).join(',');

  const result = await request.query(`
    SELECT rc.RG_No, rc.DR_No, rc.DO_Domaine, rc.DO_Type, rc.DO_Piece,
           rc.RC_Montant, rc.RG_TypeReg,
           CASE WHEN rc.cbModification > c.cbModification
                THEN rc.cbModification ELSE c.cbModification END AS cbModification
    FROM F_REGLECH rc
    INNER JOIN F_CREGLEMENT c ON c.RG_No = rc.RG_No
    INNER JOIN (VALUES ${values}) AS want(RG_No, DR_No)
      ON want.RG_No = rc.RG_No AND want.DR_No = rc.DR_No
  `);
  return result.recordset.map(mapReglementImputation);
}

module.exports = {
  getChangedReglementImputations,
  getChangedReglementImputationsPage,
  getAllReglementImputationIds,
  getReglementImputationsByIds,
};
