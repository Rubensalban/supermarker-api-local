const { getPool } = require('../config/database');
const { mapArticle } = require('../utils/mapper');

async function getChangedArticles(since) {
  const pool = await getPool();
  const result = await pool.request()
    .input('lastSync', since)
    .query(`
      SELECT AR_Ref, AR_Design, FA_CodeFamille, AR_Raccourci,
             AR_PrixAch, AR_PrixVen, AR_UnitePoids, AR_Poids,
             AR_Sommeil, AR_Suivi, AR_Publie, cbModification
      FROM F_ARTICLE
      WHERE cbModification > @lastSync
      ORDER BY cbModification ASC
    `);
  return result.recordset.map(mapArticle);
}

async function getAllArticleIds() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT AR_Ref FROM F_ARTICLE
  `);
  return result.recordset.map(row => row.AR_Ref);
}

module.exports = { getChangedArticles, getAllArticleIds };
