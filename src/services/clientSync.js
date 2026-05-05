const { getPool } = require('../config/database');
const { mapClient } = require('../utils/mapper');

const COMMERCIAL_FILTER = `CT_Type = 0 AND UPPER(LTRIM(RTRIM(CT_Commentaire))) = 'COMMERCIAL'`;

async function getChangedClients(since) {
  const pool = await getPool();
  const result = await pool.request()
    .input('lastSync', since)
    .query(`
      SELECT CT_Num, CT_Intitule, CT_Type, CT_Classement, CT_Contact,
             CT_Adresse, CT_Complement, CT_CodePostal, CT_Ville, CT_CodeRegion,
             CT_Pays, CT_Telephone, CT_Telecopie, CT_Email, CT_Site,
             CT_Siret, CT_Ape, CT_Identifiant, CT_Sommeil, CT_Commentaire,
             cbModification
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

module.exports = { getChangedClients, getAllClientIds, COMMERCIAL_FILTER };
