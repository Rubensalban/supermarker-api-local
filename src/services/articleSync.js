const { getPool } = require('../config/database');
const config = require('../config/env');
const { syncLogger } = require('../utils/logger');
const { mapArticle } = require('../utils/mapper');

// Articles liés aux factures des commerciaux : on ne synchronise que les AR_Ref
// déjà vendus à un commercial (F_COMPTET, CT_Commentaire='COMMERCIAL') via une
// facture (F_DOCENTETE DO_Domaine=0, DO_Type IN (6,7)). Filtre SYNC_START_DATE
// appliqué sur DO_Date.
//
// Pour ne pas matraquer Sage à chaque tick de sync, la liste des AR_Ref
// éligibles est mise en cache en RAM avec un TTL (SYNC_ARTICLE_CACHE_TTL).
// On utilise EXISTS plutôt que IN(SELECT DISTINCT …) — meilleur plan SQL Server.

let arRefCache = null; // { set: Set<string>, expiresAt: number }

async function loadEligibleArRefs(pool) {
  const req = pool.request();
  if (config.sync.startDate) req.input('startDate', config.sync.startDate);

  const result = await req.query(`
    SELECT l.AR_Ref
    FROM F_DOCLIGNE l
    WHERE EXISTS (
      SELECT 1 FROM F_DOCENTETE e
      WHERE e.DO_Domaine = l.DO_Domaine
        AND e.DO_Type    = l.DO_Type
        AND e.DO_Piece   = l.DO_Piece
        AND e.DO_Domaine = 0 AND e.DO_Type IN (6, 7)
        ${config.sync.startDate ? 'AND e.DO_Date >= @startDate' : ''}
        AND EXISTS (
          SELECT 1 FROM F_COMPTET c
          WHERE c.CT_Num = e.DO_Tiers
            AND c.CT_Type = 0
            AND UPPER(LTRIM(RTRIM(c.CT_Commentaire))) = 'COMMERCIAL'
        )
    )
    AND l.AR_Ref IS NOT NULL AND LTRIM(RTRIM(l.AR_Ref)) <> ''
    GROUP BY l.AR_Ref
  `);

  const set = new Set(result.recordset.map(r => r.AR_Ref));
  syncLogger.info('Articles éligibles rechargés (cache)', { count: set.size });
  return set;
}

async function getEligibleArRefSet() {
  const ttlMs = (config.sync.articleCacheTtl || 0) * 1000;
  const now = Date.now();

  if (arRefCache && (ttlMs === 0 || arRefCache.expiresAt > now)) {
    return arRefCache.set;
  }

  const pool = await getPool();
  const set = await loadEligibleArRefs(pool);
  arRefCache = { set, expiresAt: now + (ttlMs > 0 ? ttlMs : 60_000) };
  return set;
}

function invalidateCache() {
  arRefCache = null;
}

async function getChangedArticles(since) {
  const pool = await getPool();
  // 1) Articles modifiés depuis @since (requête simple sur F_ARTICLE, indexée
  //    sur cbModification dans la quasi-totalité des installations Sage).
  const result = await pool.request()
    .input('lastSync', since)
    .query(`
      SELECT AR_Ref, AR_Design, FA_CodeFamille, AR_Raccourci,
             AR_PrixAch, AR_PrixVen, AR_UnitePoids, AR_PoidsNet,
             AR_Sommeil, AR_SuiviStock, AR_Publie, cbModification
      FROM F_ARTICLE
      WHERE cbModification > @lastSync
      ORDER BY cbModification ASC
    `);

  if (result.recordset.length === 0) return [];

  // 2) Filtre en mémoire via le set d'AR_Ref éligibles (mis en cache).
  const eligible = await getEligibleArRefSet();
  return result.recordset
    .filter(row => eligible.has(row.AR_Ref))
    .map(mapArticle);
}

async function getAllArticleIds() {
  // Pour la sync full (détection des suppressions) : on renvoie directement
  // le set éligible (pas besoin de retoucher F_ARTICLE).
  const set = await getEligibleArRefSet();
  return Array.from(set);
}

module.exports = { getChangedArticles, getAllArticleIds, invalidateCache };
