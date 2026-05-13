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

module.exports = {
  getChangedReglementImputations,
  getAllReglementImputationIds,
};
