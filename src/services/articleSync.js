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
//
// Anti-perte : quand un AR_Ref devient éligible (1ère vente à un commercial),
// son cbModification peut être très ancien — la sync incrémentale standard
// (cbModification > since) ne le remonterait jamais. On capture donc le delta
// du cache (newly eligible) à chaque rechargement et on les force dans le batch
// suivant.

let arRefCache = null;            // { set: Set<string>, expiresAt: number }
let pendingNewlyEligible = new Set(); // AR_Ref à pousser au prochain getChangedArticles

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
  const newSet = await loadEligibleArRefs(pool);

  // Calcule le delta par rapport au snapshot précédent : tout AR_Ref qui
  // apparaît pour la 1ère fois doit être poussé même si cbModification < since.
  if (arRefCache) {
    for (const arRef of newSet) {
      if (!arRefCache.set.has(arRef)) pendingNewlyEligible.add(arRef);
    }
    if (pendingNewlyEligible.size > 0) {
      syncLogger.info('Articles nouvellement éligibles détectés', {
        count: pendingNewlyEligible.size,
      });
    }
  }
  // Au tout premier chargement (arRefCache === null) on ne marque rien comme
  // "newly eligible" : la sync incrémentale les ramènera via cbModification
  // (borne SYNC_START_DATE).

  arRefCache = { set: newSet, expiresAt: now + (ttlMs > 0 ? ttlMs : 60_000) };
  return newSet;
}

function invalidateCache() {
  arRefCache = null;
}

async function fetchArticlesByRefs(pool, arRefs) {
  if (arRefs.length === 0) return [];
  const req = pool.request();
  arRefs.forEach((ref, i) => req.input(`r${i}`, ref));
  const placeholders = arRefs.map((_, i) => `@r${i}`).join(',');
  const result = await req.query(`
    SELECT AR_Ref, AR_Design, FA_CodeFamille, AR_Raccourci,
           AR_PrixAch, AR_PrixVen, AR_UnitePoids, AR_PoidsNet,
           AR_Sommeil, AR_SuiviStock, AR_Publie, cbModification
    FROM F_ARTICLE
    WHERE AR_Ref IN (${placeholders})
  `);
  return result.recordset;
}

async function getChangedArticles(since) {
  const pool = await getPool();

  // Force le rechargement du cache si TTL expiré (alimente pendingNewlyEligible).
  const eligible = await getEligibleArRefSet();

  // 1) Articles modifiés depuis @since (requête simple sur F_ARTICLE, indexée
  //    sur cbModification dans la quasi-totalité des installations Sage).
  const changed = await pool.request()
    .input('lastSync', since)
    .query(`
      SELECT AR_Ref, AR_Design, FA_CodeFamille, AR_Raccourci,
             AR_PrixAch, AR_PrixVen, AR_UnitePoids, AR_PoidsNet,
             AR_Sommeil, AR_SuiviStock, AR_Publie, cbModification
      FROM F_ARTICLE
      WHERE cbModification > @lastSync
      ORDER BY cbModification ASC
    `);

  const rows = changed.recordset.filter(r => eligible.has(r.AR_Ref));

  // 2) Si des AR_Ref sont devenus éligibles depuis le dernier run, on les
  //    récupère même si cbModification est ancien — sinon ils n'arriveront
  //    jamais côté online.
  if (pendingNewlyEligible.size > 0) {
    const alreadyIncluded = new Set(rows.map(r => r.AR_Ref));
    const toFetch = [...pendingNewlyEligible].filter(ref => !alreadyIncluded.has(ref));
    const extras = await fetchArticlesByRefs(pool, toFetch);
    rows.push(...extras);
    // On vide le buffer une fois envoyé. Si l'envoi VPS échoue plus haut, le
    // syncService remettra le batch en queue — l'idempotence côté online
    // (sage_id UNIQUE + upsert atomique) garantit l'absence de doublon.
    pendingNewlyEligible = new Set();
    syncLogger.info('Articles nouvellement éligibles inclus dans le batch', {
      count: extras.length,
    });
  }

  return rows.map(mapArticle);
}

async function getAllArticleIds() {
  // Pour la sync full (détection des suppressions) : on renvoie directement
  // le set éligible (pas besoin de retoucher F_ARTICLE).
  const set = await getEligibleArRefSet();
  return Array.from(set);
}

// Récupère les articles par leurs AR_Ref (sage_id). Utilisé par la
// réconciliation du full sync pour re-créer côté online les articles
// manquants (sans dépendre de cbModification). Chunké pour rester sous la
// limite de paramètres SQL Server.
async function getArticlesByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const pool = await getPool();
  const CHUNK = 1000;
  const out = [];
  for (let start = 0; start < ids.length; start += CHUNK) {
    const slice = ids.slice(start, start + CHUNK);
    const rows = await fetchArticlesByRefs(pool, slice);
    out.push(...rows.map(mapArticle));
  }
  return out;
}

module.exports = { getChangedArticles, getAllArticleIds, getArticlesByIds, invalidateCache };
