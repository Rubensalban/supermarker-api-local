'use strict';

/**
 * Solde & dette d'un commercial (tiers Sage), calculés DIRECTEMENT dans Sage
 * (MSSQL) via la connexion de l'API-LOCAL, en reproduisant la logique de
 * BALANCE TIERS de Sage 100 Cloud.
 *
 * ── Logique Sage 100 Cloud (balance du compte payeur) ──────────────────────
 *   • Total réglé (dû au sens Sage) = Σ RG_Montant des règlements du tiers
 *                                     (F_CREGLEMENT, filtré sur RG_Date).
 *   • Total imputé                  = Σ RC_Montant des imputations de ces
 *                                     règlements (F_REGLECH), filtré sur RG_Date.
 *   • Solde (reste à imputer)       = Total réglé − Total imputé.
 *
 * IMPORTANT : le filtre de période porte sur RG_Date (date du règlement), PAS
 * sur la date de la facture — c'est ce que fait Sage 100 Cloud.
 *
 * On affiche aussi, à titre indicatif, la vue « par facture » (net à payer vs
 * imputations) qui sert à l'app mobile pour le statut payé/partiel/non payé.
 *
 * ── Utilisation ────────────────────────────────────────────────────────────
 *   node scripts/solde-commercial.js [CT_NUM] [DATE_DEBUT] [DATE_FIN]
 *
 *   CT_NUM      : code tiers Sage (défaut: CMANU)
 *   DATE_DEBUT  : YYYY-MM-DD (défaut: SYNC_START_DATE ; "all" = tout l'historique)
 *   DATE_FIN    : YYYY-MM-DD (optionnel)
 *
 * Exemples :
 *   node scripts/solde-commercial.js CMANU
 *   node scripts/solde-commercial.js CMANU 2024-01-01 2024-12-31
 *   node scripts/solde-commercial.js CMANU all
 */

const config = require('../src/config/env');
const { getPool, closePool } = require('../src/config/database');

// ── Arguments ────────────────────────────────────────────────────────────────
const ctNum = process.argv[2] || 'CMANU';
let dateDebut = process.argv[3];
const dateFin = process.argv[4] || null;

if (dateDebut === undefined) dateDebut = config.sync.startDate || null;
if (dateDebut === 'all' || dateDebut === '') dateDebut = null;

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

async function main() {
  const pool = await getPool();
  const req = pool.request().input('ct', ctNum);
  if (dateDebut) req.input('d1', dateDebut);
  if (dateFin) req.input('d2', dateFin);

  // Clauses de date : RG_Date pour les règlements/imputations, DO_Date pour les factures.
  const rgDebut = dateDebut ? 'AND c.RG_Date >= @d1' : '';
  const rgFin = dateFin ? 'AND c.RG_Date <= @d2' : '';
  const doDebut = dateDebut ? 'AND e.DO_Date >= @d1' : '';
  const doFin = dateFin ? 'AND e.DO_Date <= @d2' : '';

  const result = await req.query(`
    SELECT
      -- ── Balance tiers Sage 100 Cloud (source: compte payeur) ──────────────
      (SELECT SUM(c.RG_Montant)
         FROM F_CREGLEMENT c
        WHERE c.CT_NumPayeur = @ct ${rgDebut} ${rgFin})                       AS total_regle,

      (SELECT SUM(rc.RC_Montant)
         FROM F_REGLECH rc
         INNER JOIN F_CREGLEMENT c ON c.RG_No = rc.RG_No
        WHERE c.CT_NumPayeur = @ct ${rgDebut} ${rgFin})                       AS total_impute,

      (SELECT COUNT(*)
         FROM F_CREGLEMENT c
        WHERE c.CT_NumPayeur = @ct ${rgDebut} ${rgFin})                       AS nb_reglements,

      -- ── Vue factures (indicatif : statut payé/partiel/non payé) ────────────
      (SELECT COUNT(*)
         FROM F_DOCENTETE e
        WHERE e.DO_Domaine = 0 AND e.DO_Type IN (6,7) AND e.DO_Tiers = @ct ${doDebut} ${doFin}) AS nb_factures,

      (SELECT SUM(e.DO_NetAPayer)
         FROM F_DOCENTETE e
        WHERE e.DO_Domaine = 0 AND e.DO_Type IN (6,7) AND e.DO_Tiers = @ct ${doDebut} ${doFin}) AS total_net_a_payer
  `);

  const r = result.recordset[0];
  const totalRegle = Number(r.total_regle || 0);
  const totalImpute = Number(r.total_impute || 0);
  const solde = totalRegle - totalImpute; // reste à imputer (logique Sage)

  const periode = dateDebut
    ? `du ${dateDebut} au ${dateFin || "aujourd'hui"}`
    : "(tout l'historique Sage)";

  console.log('══════════════════════════════════════════════════════');
  console.log(`  SOLDE & DETTE — commercial ${ctNum}  ${periode}`);
  console.log(`  Source: Sage 100 (${config.mssql.database}) — logique balance tiers`);
  console.log(`  Période filtrée sur RG_Date (date du règlement)`);
  console.log('══════════════════════════════════════════════════════');
  console.log(`  Nb règlements             : ${r.nb_reglements}`);
  console.log(`  Total réglé (Σ RG_Montant): ${fmt(totalRegle)}`);
  console.log(`  Total imputé (Σ RC_Montant): ${fmt(totalImpute)}`);
  console.log('  ────────────────────────────────────────────────────');
  console.log(`  ► SOLDE (reste à imputer) : ${fmt(solde)}`);
  console.log('  ────────────────────────────────────────────────────');
  console.log(`  Indicatif — factures      : ${r.nb_factures}`);
  console.log(`  Indicatif — net à payer   : ${fmt(r.total_net_a_payer)}`);
  console.log('══════════════════════════════════════════════════════');
}

main()
  .catch((err) => {
    console.error('ERREUR:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
