const { getPool } = require('../config/database');
const { mapReglement } = require('../utils/mapper');

const COMMERCIAL_PAYEUR_SUBQUERY = `
  CT_NumPayeur IN (
    SELECT CT_Num FROM F_COMPTET
    WHERE CT_Type = 0 AND UPPER(LTRIM(RTRIM(CT_Commentaire))) = 'COMMERCIAL'
  )
`;

async function getChangedReglements(since) {
  const pool = await getPool();
  const result = await pool.request()
    .input('lastSync', since)
    .query(`
      SELECT RG_No, CT_NumPayeur, RG_Date, RG_Reference, RG_Montant,
             RG_MontantDev, N_Reglement, RG_Impute, RG_Compta,
             cbModification
      FROM F_CREGLEMENT
      WHERE ${COMMERCIAL_PAYEUR_SUBQUERY}
        AND cbModification > @lastSync
      ORDER BY cbModification ASC
    `);
  return result.recordset.map(mapReglement);
}

async function getAllReglementIds() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT RG_No FROM F_CREGLEMENT
    WHERE ${COMMERCIAL_PAYEUR_SUBQUERY}
  `);
  return result.recordset.map(row => String(row.RG_No));
}

module.exports = { getChangedReglements, getAllReglementIds };
