'use strict';

/**
 * Affiche les 3 informations d'un commercial, EXACTEMENT comme l'app mobile
 * (endpoint /account/summary), calculées directement dans Sage (MSSQL) via la
 * connexion de l'API-LOCAL. Sert de contrôle : ces valeurs doivent être
 * identiques à celles renvoyées par l'API-ONLINE.
 *
 * ── Les 3 informations (chacune depuis sa source Sage) ──────────────────────
 *   1. Solde de ses factures = Σ HT des factures de vente (F_DOCENTETE.DO_TotalHT)
 *   2. Sa dette              = solde comptable = Σ (débit − crédit) des écritures
 *                              (F_ECRITUREC) — c'est l'analyse de risque Sage 100.
 *   3. Montant déjà payé     = Σ RG_Montant des règlements du tiers (F_CREGLEMENT)
 *
 * IMPORTANT — pourquoi solde_factures ≠ dette + payé :
 *   Les 3 chiffres viennent de 3 tables/périmètres DIFFÉRENTS et ne s'additionnent
 *   pas. Le solde des factures est en HT ; la dette est un calcul COMPTABLE (TTC +
 *   TVA + avoirs + régularisations) équilibré par débit−crédit. La seule équation
 *   vraie est comptable : dette = débit comptable − crédit comptable.
 *
 * Filtre de période :
 *   - factures  : DO_Date  (date de la facture)
 *   - dette     : EC_Date  (date de l'écriture comptable)
 *   - règlements: RG_Date  (date du règlement)
 *
 * ── Utilisation ────────────────────────────────────────────────────────────
 *   node scripts/solde-commercial.js [CT_NUM] [DATE_DEBUT] [DATE_FIN]
 *     CT_NUM     : code tiers Sage (défaut: CMANU)
 *     DATE_DEBUT : YYYY-MM-DD (défaut: SYNC_START_DATE ; "all" = tout l'historique)
 *     DATE_FIN   : YYYY-MM-DD (optionnel)
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

  // Clauses de date par table (chacune sur sa propre colonne de date).
  const doDebut = dateDebut ? 'AND e.DO_Date >= @d1' : '';
  const doFin = dateFin ? 'AND e.DO_Date <= @d2' : '';
  const ecDebut = dateDebut ? 'AND ec.EC_Date >= @d1' : '';
  const ecFin = dateFin ? 'AND ec.EC_Date <= @d2' : '';
  const rgDebut = dateDebut ? 'AND c.RG_Date >= @d1' : '';
  const rgFin = dateFin ? 'AND c.RG_Date <= @d2' : '';

  const result = await req.query(`
    SELECT
      -- 1. Solde de ses factures = Σ HT des factures de vente
      (SELECT SUM(e.DO_TotalHT)
         FROM F_DOCENTETE e
        WHERE e.DO_Domaine = 0 AND e.DO_Type IN (6,7) AND e.DO_Tiers = @ct ${doDebut} ${doFin}) AS solde_factures,
      (SELECT COUNT(*)
         FROM F_DOCENTETE e
        WHERE e.DO_Domaine = 0 AND e.DO_Type IN (6,7) AND e.DO_Tiers = @ct ${doDebut} ${doFin}) AS nb_factures,

      -- 2. Dette = solde comptable = Σ (débit − crédit) des écritures (analyse de risque Sage)
      (SELECT SUM(CASE WHEN ec.EC_Sens = 0 THEN ec.EC_Montant ELSE -ec.EC_Montant END)
         FROM F_ECRITUREC ec
        WHERE ec.CT_Num = @ct ${ecDebut} ${ecFin}) AS dette,
      (SELECT SUM(CASE WHEN ec.EC_Sens = 0 THEN ec.EC_Montant ELSE 0 END)
         FROM F_ECRITUREC ec
        WHERE ec.CT_Num = @ct ${ecDebut} ${ecFin}) AS debit_comptable,
      (SELECT SUM(CASE WHEN ec.EC_Sens = 1 THEN ec.EC_Montant ELSE 0 END)
         FROM F_ECRITUREC ec
        WHERE ec.CT_Num = @ct ${ecDebut} ${ecFin}) AS credit_comptable,

      -- 3. Montant déjà payé = Σ RG_Montant des règlements du tiers
      (SELECT SUM(c.RG_Montant)
         FROM F_CREGLEMENT c
        WHERE c.CT_NumPayeur = @ct ${rgDebut} ${rgFin}) AS montant_paye,
      (SELECT COUNT(*)
         FROM F_CREGLEMENT c
        WHERE c.CT_NumPayeur = @ct ${rgDebut} ${rgFin}) AS nb_reglements
  `);

  const r = result.recordset[0];
  const soldeFactures = Number(r.solde_factures || 0);
  const dette = Number(r.dette || 0);
  const montantPaye = Number(r.montant_paye || 0);

  const periode = dateDebut
    ? `du ${dateDebut} au ${dateFin || "aujourd'hui"}`
    : "(tout l'historique Sage)";

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  COMMERCIAL ${ctNum}  ${periode}`);
  console.log(`  Source: Sage 100 (${config.mssql.database})`);
  console.log('══════════════════════════════════════════════════════════');
  console.log('  LES 3 INFORMATIONS AFFICHÉES DANS L\'APP :');
  console.log('  ────────────────────────────────────────────────────────');
  console.log(`  1. Solde de ses factures : ${fmt(soldeFactures)}   (${r.nb_factures} factures, HT)`);
  console.log(`  2. Sa dette              : ${fmt(dette)}   ◄── ce qu'il doit`);
  console.log(`  3. Montant déjà payé     : ${fmt(montantPaye)}   (${r.nb_reglements} règlements)`);
  console.log('══════════════════════════════════════════════════════════');
  console.log('  JUSTIFICATION (pourquoi 1 ≠ 2 + 3) :');
  console.log('  Les 3 chiffres viennent de 3 sources différentes et ne');
  console.log('  s\'additionnent pas. La dette est un calcul COMPTABLE :');
  console.log(`    débit comptable  : ${fmt(r.debit_comptable)}`);
  console.log(`    crédit comptable : ${fmt(r.credit_comptable)}`);
  console.log(`    dette = débit − crédit = ${fmt(dette)}  ✓`);
  console.log('══════════════════════════════════════════════════════════');
}

main()
  .catch((err) => {
    console.error('ERREUR:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
