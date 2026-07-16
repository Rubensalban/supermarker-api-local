/**
 * Mapping des colonnes Sage (SQL Server) vers le format JSON envoye a l'API-VPS.
 * Chaque fonction prend un row SQL Server et retourne un objet { sage_id, sage_updated_at, data }.
 */

function mapClient(row) {
  // cbCG_NumPrinc est un varbinary côté Sage. mssql renvoie un Buffer ; on
  // sérialise en base64 pour transit JSON. L'API-ONLINE stocke en BYTEA.
  const cbCgNumPrinc = row.cbCG_NumPrinc
    ? Buffer.isBuffer(row.cbCG_NumPrinc)
      ? row.cbCG_NumPrinc.toString('base64')
      : row.cbCG_NumPrinc
    : null;

  return {
    sage_id: row.CT_Num,
    sage_updated_at: row.cbModification,
    data: {
      ct_num: row.CT_Num,
      ct_intitule: row.CT_Intitule,
      ct_type: row.CT_Type,
      cg_numprinc: row.CG_NumPrinc,
      cbcg_numprinc: cbCgNumPrinc,
      ct_classement: row.CT_Classement,
      ct_contact: row.CT_Contact,
      ct_complement: row.CT_Complement,
      ct_ville: row.CT_Ville,
      ct_telephone: row.CT_Telephone,
    },
  };
}

function mapArticle(row) {
  return {
    sage_id: row.AR_Ref,
    sage_updated_at: row.cbModification,
    data: {
      ar_ref: row.AR_Ref,
      ar_design: row.AR_Design,
      fa_code_famille: row.FA_CodeFamille,
      ar_raccourci: row.AR_Raccourci,
      ar_prix_ach: row.AR_PrixAch,
      ar_prix_ven: row.AR_PrixVen,
      ar_unite_poids: row.AR_UnitePoids,
      ar_poids: row.AR_PoidsNet,
      ar_sommeil: row.AR_Sommeil,
      ar_suivi: row.AR_SuiviStock,
      ar_publie: row.AR_Publie,
    },
  };
}

function mapFacture(row) {
  return {
    sage_id: row.DO_Piece,
    sage_updated_at: row.cbModification,
    data: {
      do_domaine: row.DO_Domaine,
      do_type: row.DO_Type,
      do_piece: row.DO_Piece,
      do_date: row.DO_Date,
      do_ref: row.DO_Ref,
      // DO_Tiers = CT_Num du commercial (clients F_COMPTET avec CT_Commentaire='COMMERCIAL').
      // C'est l'id Sage du commercial qui possède la facture.
      do_tiers: row.DO_Tiers,
      do_total_ht: row.DO_TotalHT,
      do_total_ht_net: row.DO_TotalHTNet,
      do_total_ttc: row.DO_TotalTTC,
      do_net_a_payer: row.DO_NetAPayer,
      do_montant_regle: row.DO_MontantRegle,
      do_statut: row.DO_Statut,
      // Lien retour (DO_Type=7) -> facture d'origine cote entete Sage.
      // Peut etre vide : Sage ne le renseigne pas systematiquement, dans
      // ce cas le lien est porte par les lignes (DL_PieceBL / DL_PieceBC).
      do_piece_orig: row.DO_PieceOrig || null,
    },
    lignes: [],
  };
}

function mapFactureLigne(row) {
  return {
    sage_id: `${row.DO_Piece}_${row.DL_Ligne}`,
    data: {
      do_piece: row.DO_Piece,
      dl_ligne: row.DL_Ligne,
      ar_ref: row.AR_Ref,
      dl_design: row.DL_Design,
      dl_qte: row.DL_Qte,
      dl_prix_unitaire: row.DL_PrixUnitaire,
      dl_montant_ht: row.DL_MontantHT,
      dl_montant_ttc: row.DL_MontantTTC,
      // Tracabilite Sage : pieces d'origine (BL/BC) et quantites initiales.
      // Sur une ligne de facture retour (DO_Type=7), DL_PieceBL pointe vers
      // la facture d'origine ligne par ligne.
      dl_piece_bl: row.DL_PieceBL || null,
      dl_piece_bc: row.DL_PieceBC || null,
      dl_qte_bl: row.DL_QteBL,
      dl_qte_bc: row.DL_QteBC,
    },
  };
}

function mapReglement(row) {
  return {
    sage_id: String(row.RG_No),
    sage_updated_at: row.cbModification,
    data: {
      rg_no: row.RG_No,
      ct_num_payeur: row.CT_NumPayeur,
      rg_date: row.RG_Date,
      rg_reference: row.RG_Reference,
      rg_montant: row.RG_Montant,
      rg_montant_dev: row.RG_MontantDev,
      n_reglement: row.N_Reglement,
      rg_impute: row.RG_Impute,
      rg_compta: row.RG_Compta,
      rg_libelle: row.RG_Libelle || null,
      rg_type_reg: row.RG_TypeReg,
    },
  };
}

// Miroir d'une ligne F_REGLECH (Sage) : une imputation d'un reglement
// sur une facture. sage_id composite "{RG_No}-{DR_No}" pour rester unique.
function mapReglementImputation(row) {
  return {
    sage_id: `${row.RG_No}-${row.DR_No}`,
    sage_updated_at: row.cbModification,
    data: {
      rg_no: row.RG_No,
      dr_no: row.DR_No,
      do_domaine: row.DO_Domaine,
      do_type: row.DO_Type,
      do_piece: row.DO_Piece,
      rc_montant: row.RC_Montant,
      rg_type_reg: row.RG_TypeReg,
    },
  };
}

// Miroir d'une ecriture comptable F_ECRITUREC (Sage) sur un compte tiers.
// Sert au calcul du SOLDE COMPTABLE reel (= analyse de risque Sage) :
// solde = Σ (debit - credit) des ecritures, ou EC_Sens 0=debit, 1=credit.
// sage_id = EC_No (identifiant unique de l'ecriture).
function mapEcriture(row) {
  return {
    sage_id: String(row.EC_No),
    sage_updated_at: row.cbModification,
    data: {
      ec_no: row.EC_No,
      ct_num: row.CT_Num,
      ec_date: row.EC_Date,
      jm_date: row.JM_Date,
      ec_sens: row.EC_Sens,          // 0 = debit, 1 = credit
      ec_montant: row.EC_Montant,
      ec_lettrage: row.EC_Lettrage || null,
      ec_intitule: row.EC_Intitule || null,
    },
  };
}

module.exports = {
  mapClient,
  mapArticle,
  mapFacture,
  mapFactureLigne,
  mapReglement,
  mapReglementImputation,
  mapEcriture,
};
