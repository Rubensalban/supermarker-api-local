const { getPool } = require('../config/database');
const { mapFacture, mapFactureLigne } = require('../utils/mapper');

async function getChangedFactures(since) {
  const pool = await getPool();

  // En-tetes
  const entetes = await pool.request()
    .input('lastSync', since)
    .query(`
      SELECT DO_Domaine, DO_Type, DO_Piece, DO_Date, DO_Ref, DO_Tiers,
             DO_TotalHT, DO_TotalHTNet, DO_TotalTTC, DO_NetAPayer,
             DO_MontantRegle, DO_Statut, cbModification
      FROM F_DOCENTETE
      WHERE DO_Domaine = 0 AND DO_Type IN (6, 7) AND cbModification > @lastSync
      ORDER BY cbModification ASC
    `);

  if (entetes.recordset.length === 0) return [];

  const pieces = entetes.recordset.map(r => r.DO_Piece);

  // Lignes pour ces factures
  const lignesResult = await pool.request().query(`
    SELECT DO_Domaine, DO_Type, DO_Piece, DL_Ligne, AR_Ref,
           DL_Design, DL_Qte, DL_PrixUnitaire, DL_MontantHT,
           DL_MontantTTC, cbModification
    FROM F_DOCLIGNE
    WHERE DO_Domaine = 0 AND DO_Type IN (6, 7)
      AND DO_Piece IN (${pieces.map((_, i) => `'${pieces[i].replace(/'/g, "''")}'`).join(',')})
    ORDER BY DO_Piece, DL_Ligne
  `);

  // Grouper les lignes par piece
  const lignesMap = {};
  for (const row of lignesResult.recordset) {
    if (!lignesMap[row.DO_Piece]) lignesMap[row.DO_Piece] = [];
    lignesMap[row.DO_Piece].push(mapFactureLigne(row));
  }

  // Assembler
  return entetes.recordset.map(row => {
    const facture = mapFacture(row);
    facture.lignes = lignesMap[row.DO_Piece] || [];
    return facture;
  });
}

async function getAllFactureIds() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT DO_Piece FROM F_DOCENTETE
    WHERE DO_Domaine = 0 AND DO_Type IN (6, 7)
  `);
  return result.recordset.map(row => row.DO_Piece);
}

module.exports = { getChangedFactures, getAllFactureIds };
