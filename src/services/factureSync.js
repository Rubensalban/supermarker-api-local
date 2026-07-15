const sql = require('mssql');
const { getPool } = require('../config/database');
const config = require('../config/env');
const { mapFacture, mapFactureLigne } = require('../utils/mapper');

// Sous-requête : ne garder que les factures dont le client (DO_Tiers) est COMMERCIAL
const COMMERCIAL_TIERS_SUBQUERY = `
  DO_Tiers IN (
    SELECT CT_Num FROM F_COMPTET
    WHERE CT_Type = 0 AND UPPER(LTRIM(RTRIM(CT_Commentaire))) = 'COMMERCIAL'
  )
`;

// Filtre optionnel sur la date de pièce Sage (DO_Date), piloté par SYNC_START_DATE.
function startDateClause(prefix) {
  return config.sync.startDate ? `AND ${prefix}DO_Date >= @startDate` : '';
}

// Colonnes des en-têtes de facture. cbDO_Piece est nécessaire pour joindre les
// lignes (index seek) — voir fetchLignesForEntetes.
const ENTETE_COLS = `
  DO_Domaine, DO_Type, DO_Piece, DO_Date, DO_Ref, DO_Tiers,
  DO_TotalHT, DO_TotalHTNet, DO_TotalTTC, DO_NetAPayer,
  DO_MontantRegle, DO_Statut, DO_PieceOrig, cbModification, cbDO_Piece
`;

// Colonnes des lignes de facture à remonter.
const LIGNE_COLS = `
  l.DO_Domaine, l.DO_Type, l.DO_Piece, l.DL_Ligne, l.AR_Ref,
  l.DL_Design, l.DL_Qte, l.DL_PrixUnitaire, l.DL_MontantHT,
  l.DL_MontantTTC, l.DL_PieceBL, l.DL_PieceBC, l.DL_QteBL, l.DL_QteBC,
  l.cbModification
`;

// Charge les lignes d'un ensemble d'en-têtes DÉJÀ chargés, via un
// JOIN (VALUES ...) sur cbDO_Piece.
//
// PERF CRITIQUE : F_DOCLIGNE (~1,3M lignes) n'a PAS d'index sur DO_Piece, mais
// sur cbDO_Piece (colonne char normalisée, indexée via IDL_LIGNE/IDL_REF :
// (DO_Type, cbDO_Piece, ...)). Un filtre `DO_Piece IN (...)` force un SCAN de
// toute la table (plusieurs secondes PAR pièce → timeout sur une page).
//
// On réutilise les cbDO_Piece (buffers) déjà récupérés dans les en-têtes et on
// les injecte dans une table de valeurs `(VALUES (...),(...))` jointe à
// F_DOCLIGNE sur (DO_Domaine, DO_Type, cbDO_Piece) → INDEX SEEK. On évite ainsi
// de rejouer le tri + OFFSET/FETCH des en-têtes une 2e fois (bien plus rapide
// mesuré : ~2s vs ~17s pour 100 factures).
//
// Les en-têtes DOIVENT donc contenir cbDO_Piece (voir SELECT_ENTETE_COLS).
// SQL Server limite une requête à 2100 paramètres. On utilise 3 params par
// en-tête (DO_Domaine, DO_Type, cbDO_Piece), donc on plafonne à 600 en-têtes
// par requête (1800 params, marge de sécurité) et on boucle par sous-lots.
const LIGNES_JOIN_CHUNK = 600;

async function fetchLignesForEntetes(pool, entetes) {
  const lignesMap = {};
  if (entetes.length === 0) return lignesMap;

  for (let start = 0; start < entetes.length; start += LIGNES_JOIN_CHUNK) {
    const slice = entetes.slice(start, start + LIGNES_JOIN_CHUNK);
    const request = pool.request();
    slice.forEach((e, i) => {
      request.input(`d${i}`, sql.Int, e.DO_Domaine);
      request.input(`t${i}`, sql.Int, e.DO_Type);
      request.input(`c${i}`, sql.VarBinary, e.cbDO_Piece);
    });
    const values = slice.map((_, i) => `(@d${i},@t${i},@c${i})`).join(',');

    const lignesResult = await request.query(`
      SELECT ${LIGNE_COLS}
      FROM F_DOCLIGNE l
      INNER JOIN (VALUES ${values}) AS e(DO_Domaine, DO_Type, cbDO_Piece)
        ON e.DO_Domaine = l.DO_Domaine
       AND e.DO_Type    = l.DO_Type
       AND e.cbDO_Piece = l.cbDO_Piece
      ORDER BY l.DO_Piece, l.DL_Ligne
    `);

    for (const row of lignesResult.recordset) {
      if (!lignesMap[row.DO_Piece]) lignesMap[row.DO_Piece] = [];
      lignesMap[row.DO_Piece].push(mapFactureLigne(row));
    }
  }
  return lignesMap;
}

async function getChangedFactures(since) {
  const pool = await getPool();

  // En-tetes (filtrees sur clients commerciaux : DO_Tiers est le CT_Num du commercial,
  // donc DO_Tiers fait office d'id Sage du commercial sur la facture).
  const reqEntetes = pool.request()
    .input('lastSync', since);
  if (config.sync.startDate) reqEntetes.input('startDate', config.sync.startDate);

  const entetes = await reqEntetes.query(`
      SELECT ${ENTETE_COLS}
      FROM F_DOCENTETE
      WHERE DO_Domaine = 0 AND DO_Type IN (6, 7)
        AND ${COMMERCIAL_TIERS_SUBQUERY}
        AND cbModification > @lastSync
        ${startDateClause('')}
      ORDER BY cbModification ASC
    `);

  if (entetes.recordset.length === 0) return [];

  // Lignes via JOIN (VALUES ...) sur cbDO_Piece déjà récupérés (index seek).
  const lignesMap = await fetchLignesForEntetes(pool, entetes.recordset);

  return entetes.recordset.map(row => {
    const facture = mapFacture(row);
    facture.lignes = lignesMap[row.DO_Piece] || [];
    return facture;
  });
}

// Lecture paginée des factures (en-têtes + lignes de la page) pour la sync
// full de masse. Ordonnée par (cbModification, DO_Piece) via OFFSET/FETCH.
// Ne charge que `limit` en-têtes et leurs lignes en RAM à la fois.
async function getChangedFacturesPage(since, offset, limit) {
  const pool = await getPool();

  const reqEntetes = pool.request()
    .input('lastSync', since)
    .input('offset', sql.Int, offset)
    .input('limit', sql.Int, limit);
  if (config.sync.startDate) reqEntetes.input('startDate', config.sync.startDate);

  const entetes = await reqEntetes.query(`
      SELECT ${ENTETE_COLS}
      FROM F_DOCENTETE
      WHERE DO_Domaine = 0 AND DO_Type IN (6, 7)
        AND ${COMMERCIAL_TIERS_SUBQUERY}
        AND cbModification > @lastSync
        ${startDateClause('')}
      ORDER BY cbModification ASC, DO_Piece ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

  if (entetes.recordset.length === 0) return [];

  // Lignes de LA page via JOIN (VALUES ...) sur les cbDO_Piece déjà récupérés
  // (index seek), sans rejouer le tri/OFFSET ni IN(...) massif.
  const lignesMap = await fetchLignesForEntetes(pool, entetes.recordset);

  return entetes.recordset.map(row => {
    const facture = mapFacture(row);
    facture.lignes = lignesMap[row.DO_Piece] || [];
    return facture;
  });
}

async function getAllFactureIds() {
  const pool = await getPool();
  const req = pool.request();
  if (config.sync.startDate) req.input('startDate', config.sync.startDate);
  const result = await req.query(`
    SELECT DO_Piece FROM F_DOCENTETE
    WHERE DO_Domaine = 0 AND DO_Type IN (6, 7)
      AND ${COMMERCIAL_TIERS_SUBQUERY}
      ${startDateClause('')}
  `);
  return result.recordset.map(row => row.DO_Piece);
}

// Récupère les factures (en-têtes + lignes) par leurs DO_Piece (sage_id).
// Utilisé par la réconciliation du full sync pour re-créer côté online les
// factures manquantes. Chunké en interne pour rester sous la limite de
// paramètres SQL Server.
async function getFacturesByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const pool = await getPool();
  const CHUNK = 600;
  const out = [];

  for (let start = 0; start < ids.length; start += CHUNK) {
    const slice = ids.slice(start, start + CHUNK);
    const request = pool.request();
    slice.forEach((piece, i) => request.input(`p${i}`, piece));
    const placeholders = slice.map((_, i) => `@p${i}`).join(',');

    const entetes = await request.query(`
      SELECT ${ENTETE_COLS}
      FROM F_DOCENTETE
      WHERE DO_Domaine = 0 AND DO_Type IN (6, 7)
        AND DO_Piece IN (${placeholders})
    `);
    if (entetes.recordset.length === 0) continue;

    const lignesMap = await fetchLignesForEntetes(pool, entetes.recordset);
    for (const row of entetes.recordset) {
      const facture = mapFacture(row);
      facture.lignes = lignesMap[row.DO_Piece] || [];
      out.push(facture);
    }
  }
  return out;
}

module.exports = { getChangedFactures, getChangedFacturesPage, getAllFactureIds, getFacturesByIds };
