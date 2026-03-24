const { getPool } = require('../config/database');
const { mapReglement } = require('../utils/mapper');

async function getChangedReglements(since) {
  const pool = await getPool();
  const result = await pool.request()
    .input('lastSync', since)
    .query(`
      SELECT RG_No, CT_NumPayeur, RG_Date, RG_Reference, RG_Montant,
             RG_MontantDev, N_Reglement, RG_Impute, RG_Compta,
             DO_Piece, DO_Domaine, DO_Type, cbModification
      FROM F_CREGLEMENT
      WHERE cbModification > @lastSync
      ORDER BY cbModification ASC
    `);
  return result.recordset.map(mapReglement);
}

async function getAllReglementIds() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT RG_No FROM F_CREGLEMENT
  `);
  return result.recordset.map(row => String(row.RG_No));
}

module.exports = { getChangedReglements, getAllReglementIds };
