# API-VPS — Endpoints de reception (a implementer)

Ce fichier liste tout ce que l'API-VPS doit exposer pour recevoir les donnees de l'API-LOCAL.

---

## 1. Authentification requise

Chaque requete envoyee par API-LOCAL contient :

| Header          | Valeur                          | Description                              |
|-----------------|---------------------------------|------------------------------------------|
| `x-api-key`    | `<SYNC_API_KEY>`                | Cle partagee entre les deux API          |
| `x-signature`  | `<HMAC-SHA256 du body>`        | Optionnel — si HMAC active cote LOCAL    |
| `Content-Type` | `application/json`              | Toujours du JSON                         |

### Middleware de validation (cote VPS)

```
1. Verifier x-api-key → 401 si invalide
2. Verifier IP source → 403 si non whitelistee
3. Si HMAC active : verifier x-signature → 403 si payload altere
4. Continuer vers le controller
```

---

## 2. Endpoints a implementer

### 2.1. Healthcheck

```
GET /sync/health
```

Utilise par API-LOCAL pour verifier la connectivite (toutes les 30 secondes).

**Reponse attendue :**

```json
// 200 OK
{
  "status": "OK",
  "timestamp": "2026-03-24T14:30:00.000Z"
}
```

---

### 2.2. Reception des clients

```
POST /sync/receive/clients
```

**Body envoye par API-LOCAL :**

```json
{
  "entity_type": "client",
  "operation": "UPSERT",
  "batch_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-03-24T14:30:00.000Z",
  "records": [
    {
      "sage_id": "CLI00042",
      "sage_updated_at": "2026-03-24T14:28:00.000Z",
      "data": {
        "ct_num": "CLI00042",
        "ct_intitule": "Bijouterie Martin",
        "ct_type": 0,
        "ct_classement": "MARTIN",
        "ct_contact": "Pierre Martin",
        "ct_adresse": "12 rue des Orfevres",
        "ct_complement": "",
        "ct_code_postal": "75001",
        "ct_ville": "Paris",
        "ct_code_region": "IDF",
        "ct_pays": "France",
        "ct_telephone": "0142000000",
        "ct_telecopie": "",
        "ct_email": "contact@martin.fr",
        "ct_site": "www.martin.fr",
        "ct_siret": "12345678901234",
        "ct_ape": "4777Z",
        "ct_identifiant": "FR12345678901",
        "ct_sommeil": 0
      }
    }
  ]
}
```

**Reponse attendue :**

```json
// 200 OK
{
  "batch_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "OK",
  "processed": 1,
  "errors": 0,
  "details": []
}
```

**Cles du champ `data`** (toutes les cles possibles pour un client) :

| Cle               | Type      | Obligatoire | Description                    |
|-------------------|-----------|-------------|--------------------------------|
| `ct_num`          | `string`  | oui         | Code tiers (identifiant unique)|
| `ct_intitule`     | `string`  | oui         | Raison sociale / Nom           |
| `ct_type`         | `integer` | oui         | Type de tiers (0=Client)       |
| `ct_classement`   | `string`  | non         | Classement alphabetique        |
| `ct_contact`      | `string`  | non         | Nom du contact                 |
| `ct_adresse`      | `string`  | non         | Adresse ligne 1                |
| `ct_complement`   | `string`  | non         | Adresse complement             |
| `ct_code_postal`  | `string`  | non         | Code postal                    |
| `ct_ville`        | `string`  | non         | Ville                          |
| `ct_code_region`  | `string`  | non         | Code region                    |
| `ct_pays`         | `string`  | non         | Pays                           |
| `ct_telephone`    | `string`  | non         | Telephone                      |
| `ct_telecopie`    | `string`  | non         | Fax                            |
| `ct_email`        | `string`  | non         | Email                          |
| `ct_site`         | `string`  | non         | Site web                       |
| `ct_siret`        | `string`  | non         | SIRET                          |
| `ct_ape`          | `string`  | non         | Code APE/NAF                   |
| `ct_identifiant`  | `string`  | non         | Identifiant fiscal (NIF)       |
| `ct_sommeil`      | `integer` | non         | En sommeil (1=oui, 0=non)     |

---

### 2.3. Reception des articles

```
POST /sync/receive/articles
```

**Cles du champ `data`** :

| Cle               | Type      | Obligatoire | Description                    |
|-------------------|-----------|-------------|--------------------------------|
| `ar_ref`          | `string`  | oui         | Reference article (PK)         |
| `ar_design`       | `string`  | oui         | Designation                    |
| `fa_code_famille` | `string`  | non         | Code famille                   |
| `ar_raccourci`    | `string`  | non         | Raccourci                      |
| `ar_prix_ach`     | `number`  | non         | Prix d'achat                   |
| `ar_prix_ven`     | `number`  | non         | Prix de vente                  |
| `ar_unite_poids`  | `integer` | non         | Unite de poids                 |
| `ar_poids`        | `number`  | non         | Poids                          |
| `ar_sommeil`      | `integer` | non         | En sommeil (1=oui)             |
| `ar_suivi`        | `integer` | non         | Mode de suivi stock            |
| `ar_publie`       | `integer` | non         | Publie sur le web              |

---

### 2.4. Reception des factures (en-tetes)

```
POST /sync/receive/factures
```

**Cles du champ `data`** :

| Cle               | Type      | Obligatoire | Description                    |
|-------------------|-----------|-------------|--------------------------------|
| `do_domaine`      | `integer` | oui         | Domaine (0=Vente)              |
| `do_type`         | `integer` | oui         | Type document (6=Facture, 7=Avoir) |
| `do_piece`        | `string`  | oui         | Numero de piece (PK)           |
| `do_date`         | `string`  | oui         | Date du document (ISO 8601)    |
| `do_ref`          | `string`  | non         | Reference                      |
| `do_tiers`        | `string`  | oui         | Code tiers (FK → client)       |
| `do_total_ht`     | `number`  | non         | Total HT                       |
| `do_total_ht_net` | `number`  | non         | Total HT net                   |
| `do_total_ttc`    | `number`  | non         | Total TTC                      |
| `do_net_a_payer`  | `number`  | non         | Net a payer                    |
| `do_montant_regle`| `number`  | non         | Montant deja regle             |
| `do_statut`       | `integer` | non         | Statut du document             |

> **Note** : les lignes de facture sont envoyees dans le meme batch, dans un champ `lignes` imbrique dans chaque record de facture :

```json
{
  "sage_id": "FA00001",
  "sage_updated_at": "2026-03-24T14:28:00.000Z",
  "data": {
    "do_piece": "FA00001",
    "do_date": "2026-03-24",
    "do_tiers": "CLI00042",
    "do_total_ttc": 1200.00,
    "...": "..."
  },
  "lignes": [
    {
      "sage_id": "FA00001_1",
      "data": {
        "do_piece": "FA00001",
        "dl_ligne": 1,
        "ar_ref": "ART001",
        "dl_design": "Bague or 18k",
        "dl_qte": 2,
        "dl_prix_unitaire": 500.00,
        "dl_montant_ht": 1000.00,
        "dl_montant_ttc": 1200.00
      }
    }
  ]
}
```

**Cles du champ `data` pour les lignes** :

| Cle               | Type      | Obligatoire | Description                    |
|-------------------|-----------|-------------|--------------------------------|
| `do_piece`        | `string`  | oui         | Numero piece (FK → entete)     |
| `dl_ligne`        | `integer` | oui         | Numero de ligne                |
| `ar_ref`          | `string`  | non         | Reference article              |
| `dl_design`       | `string`  | non         | Designation ligne              |
| `dl_qte`          | `number`  | oui         | Quantite                       |
| `dl_prix_unitaire`| `number`  | non         | Prix unitaire                  |
| `dl_montant_ht`   | `number`  | non         | Montant HT                     |
| `dl_montant_ttc`  | `number`  | non         | Montant TTC                    |

> **Important** : L'API-VPS doit traiter la facture + ses lignes dans une **transaction PostgreSQL unique**. Si l'insertion d'une ligne echoue, toute la facture est rejetee.

---

### 2.5. Reception des reglements

```
POST /sync/receive/reglements
```

**Cles du champ `data`** :

| Cle               | Type      | Obligatoire | Description                    |
|-------------------|-----------|-------------|--------------------------------|
| `rg_no`           | `integer` | oui         | Numero reglement (PK)          |
| `ct_num_payeur`   | `string`  | oui         | Code tiers payeur              |
| `rg_date`         | `string`  | oui         | Date du reglement (ISO 8601)   |
| `rg_reference`    | `string`  | non         | Reference du reglement         |
| `rg_montant`      | `number`  | oui         | Montant regle                  |
| `rg_montant_dev`  | `number`  | non         | Montant en devise              |
| `n_reglement`     | `integer` | non         | Mode de reglement              |
| `rg_impute`       | `integer` | non         | Impute (0=non, 1=oui)         |
| `rg_compta`       | `integer` | non         | Comptabilise                   |
| `do_piece`        | `string`  | non         | Piece liee                     |
| `do_domaine`      | `integer` | non         | Domaine lie                    |
| `do_type`         | `integer` | non         | Type document lie               |

---

### 2.6. Detection des suppressions

```
POST /sync/receive/deletions
```

Envoye lors de la sync complete (toutes les heures). API-LOCAL envoie **la liste de tous les identifiants actifs** dans Sage. C'est API-VPS qui compare et soft-delete les absents.

**Body :**

```json
{
  "entity_type": "client",
  "timestamp": "2026-03-24T15:00:00.000Z",
  "active_sage_ids": ["CLI00001", "CLI00002", "CLI00042", "CLI00187"]
}
```

**Reponse :**

```json
{
  "status": "OK",
  "deleted_count": 3,
  "deleted_sage_ids": ["CLI00099", "CLI00155", "CLI00203"]
}
```

> **Entites concernees** : `client`, `article`, `facture`, `reglement`
> L'appel est fait une fois par entite.

---

### 2.7. Rollback (demande par API-LOCAL)

```
POST /sync/rollback
```

**Body :**

```json
{
  "type": "batch",
  "batch_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

ou rollback d'un enregistrement specifique :

```json
{
  "type": "record",
  "entity_type": "client",
  "sage_id": "CLI00042"
}
```

**Reponse :**

```json
{
  "status": "OK",
  "rolled_back": 15,
  "details": []
}
```

---

## 3. Codes de reponse HTTP

| Code | Signification                                    | Quand                                          |
|------|--------------------------------------------------|------------------------------------------------|
| 200  | Succes                                           | Tous les records traites                       |
| 207  | Multi-Status (succes partiel)                    | Certains records rejetes (voir `details`)       |
| 400  | Bad Request                                      | Payload malformed / validation echouee         |
| 401  | Unauthorized                                     | `x-api-key` manquant ou invalide               |
| 403  | Forbidden                                        | IP non whitelistee ou signature HMAC invalide  |
| 429  | Too Many Requests                                | Rate limit atteint                             |
| 500  | Internal Server Error                            | Erreur serveur cote VPS                        |
| 503  | Service Unavailable                              | PostgreSQL inaccessible cote VPS               |

---

## 4. Configuration requise cote VPS

### 4.1. Variables d'environnement a prevoir

```env
# === Authentification sync ===
SYNC_API_KEY=<meme-cle-que-SYNC_API_KEY-cote-LOCAL>
SYNC_HMAC_SECRET=<meme-secret-que-cote-LOCAL>
SYNC_HMAC_ENABLED=false
SYNC_ALLOWED_IPS=<ip-fixe-du-serveur-local>

# === PostgreSQL ===
PG_HOST=localhost
PG_PORT=5432
PG_USER=<user>
PG_PASSWORD=<password>
PG_DATABASE=<nom_base>
```

### 4.2. Ce que l'API-VPS doit gerer

| Responsabilite                     | Description                                                    |
|------------------------------------|----------------------------------------------------------------|
| **Ecriture PostgreSQL**            | UPSERT (INSERT ON CONFLICT UPDATE) des records recus           |
| **Soft delete**                    | Marquer `is_deleted = true` pour les IDs absents de la liste   |
| **Transactions**                   | Facture + lignes dans une transaction unique                   |
| **Validation**                     | Verifier les types, formats, contraintes avant ecriture        |
| **Logging**                        | Tracer chaque batch recu dans `sync_log`                       |
| **Rollback**                       | Restaurer un batch ou un record via l'historique `sync_log`    |
| **Notifications** (optionnel)      | Invalider un cache, notifier les apps mobile si besoin         |

### 4.3. Middleware de securite a implementer

```
app.use('/sync/*', verifySyncApiKey);      // Verifie x-api-key
app.use('/sync/*', verifyIpWhitelist);     // Verifie IP source
app.use('/sync/*', verifyHmacSignature);   // Optionnel : verifie x-signature
```
