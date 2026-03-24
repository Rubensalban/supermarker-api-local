# API-LOCAL — Documentation Technique

## Synchronisation Sage Bijou (SQL Server) → API-VPS

---

## 1. Vue d'ensemble

API Node.js de replication unidirectionnelle des donnees commerciales depuis une base **Sage Bijou (SQL Server)** vers un **serveur distant (VPS)** via son API REST.

L'API-LOCAL tourne sur le **meme serveur** que SQL Server. Elle detecte les changements dans Sage, les mappe en JSON, et **les envoie a l'API-VPS** qui se charge de l'ecriture dans PostgreSQL. En cas de **coupure reseau**, les payloads sont stockes dans une file d'attente locale.

```
┌──────────────────────────────────────────────────────────────────┐
│                        SERVEUR LOCAL (Docker)                    │
│                                                                  │
│  ┌──────────────┐      ┌──────────────────────────────────────┐  │
│  │  Sage Bijou  │      │          Docker Compose              │  │
│  │  SQL Server  │      │                                      │  │
│  │  (source)    │      │  ┌────────────────────────────────┐  │  │
│  └──────┬───────┘      │  │  api-local (Node.js :3500)     │  │  │
│          │             │  │  ┌─────────┐  ┌──────────┐     │  │  │
│          └────────────>│  │  │  CRON   │  │  QUEUE   │     │  │  │
│                        │  │  │ (detect)│  │ (offline)│     │  │  │
│                        │  │  └────┬────┘  └─────┬────┘     │  │  │
│                        │  │       │     /metrics │         │  │  │
│                        │  └───────┼──────┬──────┼──────────┘  │  │
│                        │          │      │      │             │  │
│                        │  ┌───────┼──────▼──────┼──────────┐  │  │
│                        │  │  prometheus (:9090)            │  │  │
│                        │  │  scrape /metrics toutes les 15s│  │  │
│                        │  └───────┼──────┬─────────────────┘  │  │
│                        │          │      │                    │  │
│                        │  ┌───────┼──────▼─────────────────┐  │  │
│                        │  │  grafana (:3000)               │  │  │
│                        │  │  dashboards de monitoring      │  │  │
│                        │  └────────────────────────────────┘  │  │
│                        └──────────────────────────────────────┘  │
│                                   │                              │
└───────────────────────────────────┼──────────────────────────────┘
                                    │
                             ───────┼────── INTERNET (HTTPS)
                                    │
                           ┌────────▼──────────────────────────┐
                           │        VPS DISTANT                │
                           │                                   │
                           │  ┌──────────────┐  ┌───────────┐  │
                           │  │   API-VPS    │  │PostgreSQL │  │
                           │  │  (reception) │─>│  (cible)  │  │
                           │  └──────────────┘  └───────────┘  │
                           │        ↑                          │
                           │   Apps Mobile / Web               │
                           └───────────────────────────────────┘
```

### Pourquoi cette architecture ?

- **Un seul maitre sur PostgreSQL** — API-VPS est le seul a ecrire, pas de conflits
- **Decouplage total** — API-LOCAL ne connait pas le schema PostgreSQL, juste les endpoints de l'API-VPS
- **Payload leger** — JSON via HTTP au lieu de requetes SQL a travers internet
- **Migrations simplifiees** — Quand le schema PG change, seul API-VPS est impacte
- **API-VPS peut enrichir** — invalider un cache, notifier les apps mobile en temps reel, etc.

---

## 2. Tables Sage Bijou (source SQL Server)

### 2.1. Clients — `F_COMPTET`

Table principale des tiers (clients, fournisseurs, etc.) dans Sage.

| Colonne Sage           | Description                    | Cle JSON envoyee       |
|------------------------|--------------------------------|------------------------|
| `CT_Num`               | Code tiers (identifiant unique)| `ct_num` (PK)         |
| `CT_Intitule`          | Raison sociale / Nom           | `ct_intitule`          |
| `CT_Type`              | Type de tiers (0=Client)       | `ct_type`              |
| `CT_Classement`        | Classement / Code alphabetique | `ct_classement`        |
| `CT_Contact`           | Nom du contact                 | `ct_contact`           |
| `CT_Adresse`           | Adresse ligne 1                | `ct_adresse`           |
| `CT_Complement`        | Adresse complement             | `ct_complement`        |
| `CT_CodePostal`        | Code postal                    | `ct_code_postal`       |
| `CT_Ville`             | Ville                          | `ct_ville`             |
| `CT_CodeRegion`        | Code region                    | `ct_code_region`       |
| `CT_Pays`              | Pays                           | `ct_pays`              |
| `CT_Telephone`         | Telephone                      | `ct_telephone`         |
| `CT_Telecopie`         | Fax                            | `ct_telecopie`         |
| `CT_Email`             | Email                          | `ct_email`             |
| `CT_Site`              | Site web                       | `ct_site`              |
| `CT_Siret`             | SIRET                          | `ct_siret`             |
| `CT_Ape`               | Code APE/NAF                   | `ct_ape`               |
| `CT_Identifiant`       | Identifiant fiscal (NIF)       | `ct_identifiant`       |
| `CT_Sommeil`           | En sommeil (1=oui)             | `ct_sommeil`           |
| `cbModification`       | Date derniere modification     | `sage_updated_at`      |

> **Filtre** : On ne synchronise que les tiers de type **Client** (`CT_Type = 0`).

### 2.2. Articles — `F_ARTICLE`

Table des articles (produits/services).

| Colonne Sage           | Description                    | Cle JSON envoyee       |
|------------------------|--------------------------------|------------------------|
| `AR_Ref`               | Reference article (PK)         | `ar_ref` (PK)         |
| `AR_Design`            | Designation                    | `ar_design`            |
| `FA_CodeFamille`       | Code famille                   | `fa_code_famille`      |
| `AR_Raccourci`         | Raccourci                      | `ar_raccourci`         |
| `AR_PrixAch`           | Prix d'achat                   | `ar_prix_ach`          |
| `AR_PrixVen`           | Prix de vente                  | `ar_prix_ven`          |
| `AR_UnitePoids`        | Unite de poids                 | `ar_unite_poids`       |
| `AR_Poids`             | Poids                          | `ar_poids`             |
| `AR_Sommeil`           | En sommeil (1=oui)             | `ar_sommeil`           |
| `AR_Suivi`             | Mode de suivi stock            | `ar_suivi`             |
| `AR_Publie`            | Publie sur le web              | `ar_publie`            |
| `cbModification`       | Date derniere modification     | `sage_updated_at`      |

### 2.3. Documents de vente (Factures) — `F_DOCENTETE`

En-tetes des documents de vente (devis, commandes, factures).

| Colonne Sage           | Description                    | Cle JSON envoyee       |
|------------------------|--------------------------------|------------------------|
| `DO_Domaine`           | Domaine (0=Vente)              | `do_domaine`           |
| `DO_Type`              | Type document (6=Facture, 7=FA avoir) | `do_type`       |
| `DO_Piece`             | Numero de piece (PK)           | `do_piece` (PK)       |
| `DO_Date`              | Date du document               | `do_date`              |
| `DO_Ref`               | Reference                      | `do_ref`               |
| `DO_Tiers`             | Code tiers (FK → client)       | `do_tiers`             |
| `DO_TotalHT`           | Total HT                       | `do_total_ht`          |
| `DO_TotalHTNet`        | Total HT net                   | `do_total_ht_net`      |
| `DO_TotalTTC`          | Total TTC                      | `do_total_ttc`         |
| `DO_NetAPayer`         | Net a payer                    | `do_net_a_payer`       |
| `DO_MontantRegle`      | Montant deja regle             | `do_montant_regle`     |
| `DO_Statut`            | Statut du document             | `do_statut`            |
| `cbModification`       | Date derniere modification     | `sage_updated_at`      |

> **Filtre** : `DO_Domaine = 0` (Ventes) et `DO_Type IN (6, 7)` (Factures et avoirs).

### 2.4. Lignes de documents — `F_DOCLIGNE`

Lignes de detail des documents de vente.

| Colonne Sage           | Description                    | Cle JSON envoyee       |
|------------------------|--------------------------------|------------------------|
| `DO_Domaine`           | Domaine                        | `do_domaine`           |
| `DO_Type`              | Type document                  | `do_type`              |
| `DO_Piece`             | Numero piece (FK → entete)     | `do_piece`             |
| `DL_Ligne`             | Numero de ligne                | `dl_ligne`             |
| `AR_Ref`               | Reference article              | `ar_ref`               |
| `DL_Design`            | Designation ligne              | `dl_design`            |
| `DL_Qte`               | Quantite                       | `dl_qte`               |
| `DL_PrixUnitaire`      | Prix unitaire                  | `dl_prix_unitaire`     |
| `DL_MontantHT`         | Montant HT                     | `dl_montant_ht`        |
| `DL_MontantTTC`        | Montant TTC                    | `dl_montant_ttc`       |
| `cbModification`       | Date derniere modification     | `sage_updated_at`      |

### 2.5. Reglements — `F_CREGLEMENT`

Table des reglements clients.

| Colonne Sage           | Description                    | Cle JSON envoyee       |
|------------------------|--------------------------------|------------------------|
| `RG_No`                | Numero reglement (PK)          | `rg_no` (PK)          |
| `CT_NumPayeur`         | Code tiers payeur              | `ct_num_payeur`        |
| `RG_Date`              | Date du reglement              | `rg_date`              |
| `RG_Reference`         | Reference du reglement         | `rg_reference`         |
| `RG_Montant`           | Montant regle                  | `rg_montant`           |
| `RG_MontantDev`        | Montant en devise              | `rg_montant_dev`       |
| `N_Reglement`          | Mode de reglement              | `n_reglement`          |
| `RG_Impute`            | Impute (0=non, 1=oui)         | `rg_impute`            |
| `RG_Compta`            | Comptabilise                   | `rg_compta`            |
| `DO_Piece`             | Piece liee                     | `do_piece`             |
| `DO_Domaine`           | Domaine lie                    | `do_domaine`           |
| `DO_Type`              | Type document lie               | `do_type`              |
| `cbModification`       | Date derniere modification     | `sage_updated_at`      |

---

## 3. Communication API-LOCAL → API-VPS

### 3.1. Principe

API-LOCAL **ne connait pas PostgreSQL**. Elle envoie des payloads JSON a l'API-VPS via des appels HTTP. C'est API-VPS qui se charge de :

- Valider les donnees recues
- Ecrire dans PostgreSQL (UPSERT, soft delete)
- Logger les operations
- Gerer les rollbacks
- Notifier les apps connectees si besoin

### 3.2. Securite des echanges inter-API

Les echanges entre API-LOCAL et API-VPS sont **strictement verrouilles** :

```
┌───────────────────────────────────────────────────────┐
│            Securite inter-API (3 couches)             │
│                                                       │
│  1. HTTPS obligatoire                                 │
│     → Chiffrement TLS en transit                      │
│                                                       │
│  2. x-api-key (cle partagee)                          │
│     → Seul API-LOCAL possede la cle                   │
│     → API-VPS rejette toute requete sans cle valide   │
│                                                       │
│  3. IP Whitelist (recommande)                         │
│     → API-VPS n'accepte les appels sync que depuis    │
│       l'IP fixe du serveur local                      │
└───────────────────────────────────────────────────────┘
```

| Couche                | Implementation                                                    |
|-----------------------|-------------------------------------------------------------------|
| **HTTPS**             | Toutes les communications via TLS. Jamais de HTTP en clair.       |
| **x-api-key**         | Header `x-api-key: <SYNC_API_KEY>` sur chaque requete vers le VPS. Cle longue (64+ caracteres), aleatoire, unique a cette liaison. |
| **IP Whitelist**      | API-VPS filtre les routes `/sync/receive/*` par IP source. Seule l'IP du serveur local est autorisee. |
| **Signature HMAC** (recommandation) | En complement de l'API Key, signer chaque payload avec un secret partage (HMAC-SHA256). Cela garantit l'integrite du payload : meme si la cle API est interceptee, un attaquant ne peut pas forger de faux payloads. |

#### Signature HMAC — comment ca marche

```
API-LOCAL (envoi) :
  1. Construire le body JSON
  2. Calculer : signature = HMAC-SHA256(body, SYNC_HMAC_SECRET)
  3. Envoyer avec header : x-signature: <signature>

API-VPS (reception) :
  1. Lire le body brut
  2. Recalculer : expected = HMAC-SHA256(body, SYNC_HMAC_SECRET)
  3. Comparer signature == expected
  4. Si different → rejeter (403 Payload Tampered)
```

> **Recommandation** : La combinaison `HTTPS + x-api-key + IP Whitelist` est deja solide. Le HMAC est une couche supplementaire pour les cas ou une securite maximale est requise (donnees financieres). A implementer si necessaire.

### 3.3. Format des payloads envoyes

Chaque appel vers l'API-VPS envoie un **batch** d'enregistrements. Le format est identique pour toutes les entites :

```json
{
  "entity_type": "client",
  "operation": "UPSERT",
  "batch_id": "uuid-v4",
  "timestamp": "2026-03-24T14:30:00.000Z",
  "records": [
    {
      "sage_id": "CLI00042",
      "sage_updated_at": "2026-03-24T14:28:00.000Z",
      "data": {
        "ct_num": "CLI00042",
        "ct_intitule": "Bijouterie Martin",
        "ct_type": 0,
        "ct_adresse": "12 rue des Orfevres",
        "ct_code_postal": "75001",
        "ct_ville": "Paris",
        "ct_email": "contact@martin.fr"
      }
    }
  ]
}
```

Pour les suppressions (sync complete) :

```json
{
  "entity_type": "client",
  "operation": "SOFT_DELETE",
  "batch_id": "uuid-v4",
  "timestamp": "2026-03-24T15:00:00.000Z",
  "sage_ids": ["CLI00099", "CLI00187"]
}
```

### 3.4. Reponse attendue de l'API-VPS

```json
{
  "batch_id": "uuid-v4",
  "status": "OK",
  "processed": 15,
  "errors": 0,
  "details": []
}
```

En cas d'erreurs partielles :

```json
{
  "batch_id": "uuid-v4",
  "status": "PARTIAL",
  "processed": 13,
  "errors": 2,
  "details": [
    { "sage_id": "CLI00042", "error": "Validation failed: ct_email format invalid" },
    { "sage_id": "CLI00099", "error": "Duplicate sage_id conflict" }
  ]
}
```

---

## 4. Mecanisme de detection des changements

### 4.1. Strategie : Comparaison par `cbModification`

Sage ajoute automatiquement un champ `cbModification` (datetime) sur chaque enregistrement. A chaque cycle de sync :

1. **Lire** la date de derniere sync reussie pour chaque entite (stockee dans `sync_metadata` local)
2. **Requeter** SQL Server : `WHERE cbModification > @lastSync`
3. **Mapper** en JSON et **envoyer** a l'API-VPS

### 4.2. Detection des suppressions

Sage ne marque pas les suppressions avec `cbModification`. Strategie :

1. A chaque cycle complet (ex: toutes les heures), lister **tous les identifiants** cote SQL Server
2. Envoyer la liste complete a l'API-VPS via `POST /sync/receive/deletions`
3. **C'est l'API-VPS** qui compare avec ses donnees PostgreSQL et applique les soft deletes

### 4.3. Table de metadata locale — `sync_metadata` (SQLite)

| Colonne              | Type        | Description                              |
|----------------------|-------------|------------------------------------------|
| `id`                 | `INTEGER`   | PK                                       |
| `entity_type`        | `VARCHAR`   | `client`, `article`, `facture`, etc.     |
| `last_sync_at`       | `DATETIME`  | Derniere sync incrementale reussie       |
| `last_full_sync_at`  | `DATETIME`  | Derniere sync complete (pour deletions)  |
| `last_sync_status`   | `VARCHAR`   | `SUCCESS`, `FAILED`                      |
| `records_synced`     | `INTEGER`   | Nombre d'enregistrements synchronises    |

---

## 5. Gestion du mode hors-ligne (Queue locale)

### 5.1. Probleme

L'API-VPS est sur un serveur **distant**. En cas de coupure internet, l'API-LOCAL ne peut pas envoyer les donnees.

### 5.2. Solution : File d'attente locale SQLite

```
┌──────────────────────────────────────────────────────┐
│              Cycle de synchronisation                │
│                                                      │
│  1. Lire changements SQL Server                      │
│  2. Mapper en JSON (payload)                         │
│  3. API-VPS accessible ?                             │
│     ├─ OUI → POST vers API-VPS                       │
│     └─ NON → Stocker le payload dans Queue (SQLite)  │
│                                                      │
│  4. Quand connexion retablie :                       │
│     → Depiler la queue dans l'ordre                  │
│     → Envoyer les payloads vers API-VPS              │
│     → Marquer comme traites                          │
└──────────────────────────────────────────────────────┘
```

### 5.3. Table de queue locale — `sync_queue` (SQLite)

| Colonne        | Type       | Description                              |
|----------------|------------|------------------------------------------|
| `id`           | `INTEGER`  | PK auto-increment                        |
| `entity_type`  | `VARCHAR`  | `client`, `article`, `facture`, etc.     |
| `operation`    | `VARCHAR`  | `UPSERT`, `SOFT_DELETE`                  |
| `sage_id`      | `VARCHAR`  | Identifiant Sage                         |
| `payload`      | `TEXT`     | JSON complet a envoyer a l'API-VPS       |
| `status`       | `VARCHAR`  | `PENDING`, `PROCESSING`, `DONE`, `FAILED`|
| `attempts`     | `INTEGER`  | Nombre de tentatives                     |
| `max_attempts` | `INTEGER`  | Max tentatives avant abandon (defaut: 5) |
| `error`        | `TEXT`     | Derniere erreur                          |
| `created_at`   | `DATETIME` | Date de mise en queue                    |
| `processed_at` | `DATETIME` | Date de traitement                       |

### 5.4. Regles de la queue

- **Ordre garanti** : les operations sont rejouees dans l'ordre chronologique (FIFO)
- **Deduplication** : si un meme `sage_id` a plusieurs operations en attente, seule la derniere est conservee (la plus recente ecrase les precedentes)
- **Retry** : 5 tentatives max avec backoff exponentiel (1s, 5s, 30s, 2min, 10min)
- **Healthcheck** : un ping API-VPS toutes les 30 secondes pour detecter le retour de connexion

---

## 6. Cron Jobs — Planification

| Job                         | Frequence        | Description                                                |
|-----------------------------|------------------|------------------------------------------------------------|
| `sync:incremental`          | Toutes les 2 min | Detecte les changements (`cbModification`) et envoie a l'API-VPS |
| `sync:full`                 | Toutes les heures| Envoie tous les identifiants a l'API-VPS pour detection des suppressions |
| `queue:process`             | Toutes les 30 sec| Depile la queue locale si API-VPS est accessible           |
| `queue:healthcheck`         | Toutes les 30 sec| Verifie la connectivite API-VPS (`GET /sync/health`)       |
| `sync:cleanup`              | Tous les jours   | Purge les logs locaux de sync de plus de 30 jours          |
| `alerts:check`              | Toutes les 1 min | Evalue les regles d'alerte et ecrit dans les logs          |

---

## 7. Endpoints API REST (API-LOCAL)

### 7.1. Authentification

Authentification par **API Key uniquement** (machine-to-machine). Pas de JWT — une cle statique suffit pour une API de synchronisation interne sans multi-utilisateurs.

**Header requis sur toutes les routes** : `x-api-key: <API_KEY>`

### 7.2. Synchronisation manuelle

| Methode | Route                          | Description                                    |
|---------|--------------------------------|------------------------------------------------|
| `POST`  | `/api/sync/clients`            | Force la sync incrementale des clients          |
| `POST`  | `/api/sync/articles`           | Force la sync incrementale des articles         |
| `POST`  | `/api/sync/factures`           | Force la sync incrementale des factures         |
| `POST`  | `/api/sync/reglements`         | Force la sync incrementale des reglements       |
| `POST`  | `/api/sync/all`                | Force la sync de toutes les entites             |
| `POST`  | `/api/sync/full`               | Force une sync complete (avec detection delete) |
| `POST`  | `/api/sync/pause`              | Met en pause les cron jobs de sync              |
| `POST`  | `/api/sync/resume`             | Reprend les cron jobs de sync                   |

### 7.3. Monitoring / Status

| Methode | Route                          | Description                                    |
|---------|--------------------------------|------------------------------------------------|
| `GET`   | `/api/status`                  | Etat general (connexions, derniere sync)        |
| `GET`   | `/api/status/connections`      | Etat des connexions SQL Server et API-VPS       |
| `GET`   | `/api/status/queue`            | Nombre d'elements en queue + etat               |
| `GET`   | `/api/sync/logs`               | Journal des synchronisations (pagine)           |
| `GET`   | `/api/sync/logs/:entityType`   | Logs filtres par entite                         |
| `GET`   | `/api/alerts`                  | Liste des alertes actives                       |
| `GET`   | `/api/alerts/history`          | Historique des alertes (pagine)                 |

### 7.4. Gestion de la queue

| Methode | Route                          | Description                                    |
|---------|--------------------------------|------------------------------------------------|
| `GET`   | `/api/queue`                   | Liste les elements en attente                   |
| `POST`  | `/api/queue/retry`             | Relance les elements en erreur                  |
| `DELETE` | `/api/queue/purge`            | Purge les elements traites                      |

### 7.5. Metriques Prometheus

| Methode | Route                          | Description                                    |
|---------|--------------------------------|------------------------------------------------|
| `GET`   | `/metrics`                     | Endpoint Prometheus (format OpenMetrics)        |

> **Note** : L'endpoint `/metrics` est **sans authentification** par defaut pour permettre le scraping Prometheus. Dans Docker, le container `prometheus` accede a `/metrics` via le reseau interne `monitoring`. En dehors de Docker, l'acces est restreint par filtre IP (`METRICS_ALLOWED_IPS`).

---

## 8. Securite

### 8.1. Authentification API-LOCAL (routes locales)

Authentification par cle statique dans le header `x-api-key` pour les routes de l'API-LOCAL elle-meme :

- La cle `API_KEY` est longue, aleatoire, et stockee dans `.env`
- Chaque requete est validee par le middleware `apiKeyAuth.js`

### 8.2. Authentification API-LOCAL → API-VPS (inter-API)

Les appels vers l'API-VPS utilisent une **cle dediee separee** (`SYNC_API_KEY`) :

- Header `x-api-key: <SYNC_API_KEY>` sur chaque requete sortante
- Header `x-signature: <HMAC-SHA256>` si le HMAC est active (voir section 3.2)
- Toujours via **HTTPS**
- API-VPS filtre par **IP Whitelist** en complement

> **Important** : `API_KEY` (locale) et `SYNC_API_KEY` (vers VPS) sont **deux cles differentes**. Ne jamais reutiliser la meme cle pour les deux usages.

### 8.3. Mesures supplementaires

| Mesure              | Implementation                                          |
|---------------------|---------------------------------------------------------|
| **Helmet**          | Headers HTTP securises                                  |
| **CORS**            | Origines autorisees configurables                       |
| **Rate Limiting**   | Max 100 req/min par IP                                  |
| **Validation**      | Validation des parametres d'entree                      |
| **Logs**            | Winston pour le logging structure                       |
| **Env vars**        | Toutes les credentials dans `.env` (jamais en dur)      |
| **IP Whitelist**    | Filtre IP sur `/metrics` pour le scraping Prometheus    |

---

## 9. Systeme d'alertes

### 9.1. Vue d'ensemble

Le systeme d'alertes surveille les evenements critiques et ecrit les alertes dans des **fichiers de log dedies** via Winston. Les alertes sont aussi exposees via l'API pour consultation.

```
┌──────────────────────────────────────────────────────┐
│                  ALERT SERVICE                       │
│                                                      │
│  Regles evaluees toutes les minutes :                │
│                                                      │
│  ┌─────────────────┐    ┌──────────────────────────┐ │
│  │ Sync echouee    │    │                          │ │
│  │ Queue > seuil   │───>│  Winston Alert Logger    │ │
│  │ API-VPS down    │    │  → logs/alerts.log       │ │
│  │ Retry epuises   │    │  → logs/alerts-error.log │ │
│  └─────────────────┘    │  → console (dev)         │ │
│                         └──────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### 9.2. Regles d'alerte

| Regle                              | Niveau     | Condition                                              |
|------------------------------------|------------|--------------------------------------------------------|
| `sync_failure`                     | `ERROR`    | Une sync incrementale ou complete echoue               |
| `sync_consecutive_failures`        | `CRITICAL` | 3 echecs de sync consecutifs pour une meme entite      |
| `queue_threshold_warning`          | `WARNING`  | Queue locale > 1 000 elements en attente               |
| `queue_threshold_critical`         | `CRITICAL` | Queue locale > 5 000 elements en attente               |
| `queue_item_max_retries`           | `ERROR`    | Un element de la queue atteint le max de tentatives     |
| `api_vps_unreachable`              | `CRITICAL` | API-VPS ne repond pas au healthcheck                    |
| `api_vps_error_response`           | `ERROR`    | API-VPS repond avec un code HTTP 5xx                    |
| `api_vps_partial_rejection`        | `WARNING`  | API-VPS rejette certains records d'un batch             |
| `connection_lost_sqlserver`        | `CRITICAL` | Perte de connexion SQL Server                           |
| `connection_restored`              | `INFO`     | Connexion retablie apres une perte                      |
| `sync_latency_high`               | `WARNING`  | Un cycle de sync depasse 60 secondes                    |
| `disk_usage_queue`                 | `WARNING`  | Fichier `queue.sqlite` depasse 100 Mo                   |

### 9.3. Format des alertes dans les logs

Chaque alerte est ecrite en JSON structure dans `logs/alerts.log` :

```json
{
  "timestamp": "2026-03-24T14:30:00.000Z",
  "level": "CRITICAL",
  "rule": "api_vps_unreachable",
  "message": "API-VPS inaccessible depuis 2 minutes",
  "context": {
    "vps_url": "https://api.example.com",
    "last_successful_call": "2026-03-24T14:28:00.000Z",
    "consecutive_failures": 4,
    "http_error": "ECONNREFUSED"
  }
}
```

### 9.4. Configuration des fichiers de log d'alertes (Winston)

| Fichier                    | Contenu                                      | Rotation         |
|----------------------------|----------------------------------------------|------------------|
| `logs/alerts.log`          | Toutes les alertes (tous niveaux)            | 10 Mo, 30 jours  |
| `logs/alerts-error.log`    | Uniquement `ERROR` et `CRITICAL`             | 10 Mo, 60 jours  |
| `logs/app.log`             | Logs applicatifs generaux                    | 10 Mo, 14 jours  |
| `logs/sync.log`            | Logs detailles des cycles de sync            | 20 Mo, 30 jours  |

> **Rotation** : geree par `winston-daily-rotate-file`. Les fichiers sont compresses en `.gz` apres rotation.

### 9.5. Table de suivi des alertes — `alert_history` (SQLite)

Historique local des alertes pour consultation via l'API :

| Colonne        | Type       | Description                              |
|----------------|------------|------------------------------------------|
| `id`           | `INTEGER`  | PK auto-increment                        |
| `rule`         | `VARCHAR`  | Nom de la regle declenchee               |
| `level`        | `VARCHAR`  | `INFO`, `WARNING`, `ERROR`, `CRITICAL`   |
| `message`      | `TEXT`     | Description de l'alerte                  |
| `context`      | `TEXT`     | JSON avec les details contextuels        |
| `acknowledged` | `BOOLEAN`  | Acquittee par un operateur (defaut: false)|
| `created_at`   | `DATETIME` | Date de declenchement                    |

---

## 10. Monitoring — Prometheus + Grafana (Docker)

### 10.1. Vue d'ensemble

Toute la stack de monitoring tourne dans **Docker Compose** aux cotes de l'API. Prometheus scrape les metriques, Grafana les affiche dans des dashboards preconfigures.

```
┌─────────────────────── Docker Compose ───────────────────────┐
│                                                              │
│  ┌─────────────────┐  scrape :3500/metrics  ┌─────────────┐  │
│  │   api-local     │◄───────────────────────│  prometheus │  │
│  │   (Node.js)     │    toutes les 15s      │  (:9090)    │  │
│  │   :3500         │                        └──────┬──────┘  │
│  └─────────────────┘                               │         │
│                                              datasource      │
│                                                    │         │
│                                             ┌──────▼──────┐  │
│                                             │   grafana   │  │
│                                             │   (:3000)   │  │
│                                             │  dashboards │  │
│                                             └─────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 10.2. Containers Docker

| Service      | Image                    | Port  | Role                                      |
|--------------|--------------------------|-------|--------------------------------------------|
| `api-local`  | Build local (`Dockerfile`) | 3500  | API de synchronisation                     |
| `prometheus` | `prom/prometheus:latest`  | 9090  | Collecte et stockage des metriques (TSDB)  |
| `grafana`    | `grafana/grafana:latest`  | 3000  | Visualisation des dashboards               |

### 10.3. Metriques exposees

#### Synchronisation

| Metrique                                  | Type      | Labels                     | Description                                    |
|-------------------------------------------|-----------|----------------------------|------------------------------------------------|
| `sync_cycles_total`                       | Counter   | `entity`, `type`, `status` | Nombre total de cycles de sync executes         |
| `sync_records_processed_total`            | Counter   | `entity`, `operation`      | Nombre d'enregistrements traites                |
| `sync_cycle_duration_seconds`             | Histogram | `entity`, `type`           | Duree d'un cycle de sync (buckets: 1s-120s)    |
| `sync_last_success_timestamp`             | Gauge     | `entity`, `type`           | Timestamp de la derniere sync reussie           |
| `sync_errors_total`                       | Counter   | `entity`, `error_type`     | Nombre d'erreurs par type                       |

#### Communication API-VPS

| Metrique                                  | Type      | Labels                     | Description                                    |
|-------------------------------------------|-----------|----------------------------|------------------------------------------------|
| `vps_requests_total`                      | Counter   | `endpoint`, `status`       | Nombre total d'appels vers API-VPS              |
| `vps_request_duration_seconds`            | Histogram | `endpoint`                 | Latence des appels vers API-VPS                 |
| `vps_connection_up`                       | Gauge     | —                          | 1 = API-VPS accessible, 0 = inaccessible        |
| `vps_records_sent_total`                  | Counter   | `entity`                   | Nombre de records envoyes avec succes           |
| `vps_records_rejected_total`              | Counter   | `entity`                   | Nombre de records rejetes par API-VPS           |

#### Queue locale

| Metrique                                  | Type      | Labels                     | Description                                    |
|-------------------------------------------|-----------|----------------------------|------------------------------------------------|
| `queue_size`                              | Gauge     | `status`                   | Nombre d'elements dans la queue par statut      |
| `queue_oldest_pending_seconds`            | Gauge     | —                          | Age du plus ancien element PENDING              |
| `queue_processed_total`                   | Counter   | `status`                   | Nombre d'elements depiles (DONE/FAILED)         |
| `queue_processing_duration_seconds`       | Histogram | —                          | Duree de traitement d'un element de queue       |

#### Connexions

| Metrique                                  | Type      | Labels                     | Description                                    |
|-------------------------------------------|-----------|----------------------------|------------------------------------------------|
| `db_connection_up`                        | Gauge     | `database`                 | 1 = connecte, 0 = deconnecte (sqlserver)        |
| `db_connection_latency_seconds`           | Histogram | `database`                 | Latence du healthcheck (ping)                   |
| `db_connection_errors_total`              | Counter   | `database`                 | Nombre total d'erreurs de connexion             |

#### Alertes

| Metrique                                  | Type      | Labels                     | Description                                    |
|-------------------------------------------|-----------|----------------------------|------------------------------------------------|
| `alerts_active`                           | Gauge     | `level`                    | Nombre d'alertes actives par niveau             |
| `alerts_fired_total`                      | Counter   | `rule`, `level`            | Nombre total d'alertes declenchees              |

#### API HTTP (routes locales)

| Metrique                                  | Type      | Labels                     | Description                                    |
|-------------------------------------------|-----------|----------------------------|------------------------------------------------|
| `http_requests_total`                     | Counter   | `method`, `route`, `status`| Nombre total de requetes HTTP                   |
| `http_request_duration_seconds`           | Histogram | `method`, `route`          | Duree des requetes HTTP                         |

#### Node.js (metriques par defaut de `prom-client`)

- `process_cpu_seconds_total` — Temps CPU consomme
- `process_resident_memory_bytes` — Memoire RSS
- `nodejs_heap_size_total_bytes` — Taille du heap
- `nodejs_active_handles_total` — Handles actifs
- `nodejs_eventloop_lag_seconds` — Lag de l'event loop

### 10.4. Docker Compose

Fichier `docker-compose.yml` :

```yaml
version: '3.8'

services:
  # === API de synchronisation ===
  api-local:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: api-local
    restart: unless-stopped
    ports:
      - "3500:3500"
    env_file:
      - .env
    volumes:
      - api-data:/app/data         # SQLite (queue + alert_history + sync_metadata)
      - api-logs:/app/logs         # Fichiers de log Winston
    networks:
      - monitoring
    extra_hosts:
      - "host.docker.internal:host-gateway"
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3500/api/status"]
      interval: 30s
      timeout: 10s
      retries: 3

  # === Prometheus — Collecte des metriques ===
  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    restart: unless-stopped
    ports:
      - "9090:9090"
    volumes:
      - ./monitoring/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./monitoring/prometheus/alerts.yml:/etc/prometheus/alerts.yml:ro
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=30d'
      - '--web.enable-lifecycle'
    networks:
      - monitoring
    depends_on:
      - api-local

  # === Grafana — Dashboards de visualisation ===
  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_USER=${GRAFANA_USER:-admin}
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD:-admin}
      - GF_USERS_ALLOW_SIGN_UP=false
    volumes:
      - grafana-data:/var/lib/grafana
      - ./monitoring/grafana/provisioning:/etc/grafana/provisioning:ro
      - ./monitoring/grafana/dashboards:/var/lib/grafana/dashboards:ro
    networks:
      - monitoring
    depends_on:
      - prometheus

volumes:
  api-data:
  api-logs:
  prometheus-data:
  grafana-data:

networks:
  monitoring:
    driver: bridge
```

### 10.5. Dockerfile

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

COPY src/ ./src/

RUN mkdir -p /app/data /app/logs

EXPOSE 3500

USER node

CMD ["node", "src/app.js"]
```

### 10.6. Configuration Prometheus

Fichier `monitoring/prometheus/prometheus.yml` :

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - alerts.yml

scrape_configs:
  - job_name: 'api-local-sync'
    static_configs:
      - targets: ['api-local:3500']
    metrics_path: '/metrics'
    scrape_interval: 15s
```

### 10.7. Alertes Prometheus

Fichier `monitoring/prometheus/alerts.yml` :

```yaml
groups:
  - name: api-local-sync
    rules:
      - alert: SyncDown
        expr: time() - sync_last_success_timestamp{type="incremental"} > 600
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Sync incrementale inactive depuis > 10 min ({{ $labels.entity }})"

      - alert: QueueBacklog
        expr: queue_size{status="PENDING"} > 1000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Queue locale > 1000 elements en attente"

      - alert: ApiVpsDown
        expr: vps_connection_up == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "API-VPS inaccessible depuis > 2 min"

      - alert: ApiVpsHighLatency
        expr: histogram_quantile(0.95, rate(vps_request_duration_seconds_bucket[5m])) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "P95 latence vers API-VPS > 10s"

      - alert: ApiVpsHighRejectionRate
        expr: rate(vps_records_rejected_total[5m]) / rate(vps_records_sent_total[5m]) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Taux de rejet API-VPS > 5%"

      - alert: SqlServerDown
        expr: db_connection_up{database="sqlserver"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "SQL Server inaccessible depuis > 2 min"

      - alert: HighSyncLatency
        expr: histogram_quantile(0.95, rate(sync_cycle_duration_seconds_bucket[5m])) > 60
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "P95 duree de sync > 60s ({{ $labels.entity }})"

      - alert: EventLoopLag
        expr: nodejs_eventloop_lag_seconds > 1
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Event loop lag Node.js > 1s"

      - alert: ContainerHighMemory
        expr: process_resident_memory_bytes > 512 * 1024 * 1024
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Container api-local utilise > 512 Mo de RAM"

      - alert: HighErrorRate
        expr: rate(sync_errors_total[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Taux d'erreurs de sync > 0.1/s"
```

### 10.8. Provisioning Grafana

#### Datasource — `monitoring/grafana/provisioning/datasources/prometheus.yml`

```yaml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
```

#### Dashboard provider — `monitoring/grafana/provisioning/dashboards/dashboards.yml`

```yaml
apiVersion: 1

providers:
  - name: 'API-LOCAL'
    orgId: 1
    folder: 'API-LOCAL Sync'
    type: file
    disableDeletion: false
    editable: true
    options:
      path: /var/lib/grafana/dashboards
      foldersFromFilesStructure: false
```

### 10.9. Dashboards Grafana

Trois dashboards preconfigures dans `monitoring/grafana/dashboards/` :

#### Dashboard 1 — Vue d'ensemble (`overview.json`)

| Panel                              | Type        | Metrique / Query                                              |
|------------------------------------|-------------|---------------------------------------------------------------|
| **Statut API-VPS**                 | Stat        | `vps_connection_up`                                           |
| **Statut SQL Server**              | Stat        | `db_connection_up{database="sqlserver"}`                      |
| **Derniere sync reussie**          | Stat        | `time() - sync_last_success_timestamp`                        |
| **Records envoyes (24h)**          | Stat        | `increase(vps_records_sent_total[24h])`                       |
| **Alertes actives**                | Stat        | `alerts_active`                                               |
| **Taille de la queue**             | Gauge       | `queue_size{status="PENDING"}`                                |
| **Cycles de sync / heure**         | Time series | `rate(sync_cycles_total[1h])`                                 |
| **Taux d'erreurs**                 | Time series | `rate(sync_errors_total[5m])`                                 |

#### Dashboard 2 — Synchronisation & API-VPS (`sync-details.json`)

| Panel                              | Type        | Metrique / Query                                              |
|------------------------------------|-------------|---------------------------------------------------------------|
| **Records envoyes par entite**     | Time series | `rate(vps_records_sent_total[5m])` par `entity`               |
| **Records rejetes par entite**     | Time series | `rate(vps_records_rejected_total[5m])` par `entity`           |
| **Latence API-VPS P50/P95/P99**   | Time series | `histogram_quantile(0.5/0.95/0.99, rate(vps_request_duration_seconds_bucket[5m]))` |
| **Duree de sync P50/P95/P99**      | Time series | `histogram_quantile(0.5/0.95/0.99, rate(sync_cycle_duration_seconds_bucket[5m]))` |
| **Appels API-VPS par status**      | Pie chart   | `increase(vps_requests_total[24h])` par `status`              |
| **Erreurs par entite**             | Bar gauge   | `increase(sync_errors_total[1h])` par `entity`                |
| **Derniere sync par entite**       | Table       | `sync_last_success_timestamp` par `entity` + `type`           |
| **Heatmap duree de sync**          | Heatmap     | `rate(sync_cycle_duration_seconds_bucket[5m])`                |

#### Dashboard 3 — Queue & Infrastructure (`queue-infra.json`)

| Panel                              | Type        | Metrique / Query                                              |
|------------------------------------|-------------|---------------------------------------------------------------|
| **Queue : elements en attente**    | Time series | `queue_size{status="PENDING"}`                                |
| **Queue : elements echoues**       | Time series | `queue_size{status="FAILED"}`                                 |
| **Queue : age du plus ancien**     | Stat        | `queue_oldest_pending_seconds`                                |
| **Queue : debit traitement**       | Time series | `rate(queue_processed_total[5m])`                             |
| **Queue : duree traitement**       | Time series | `histogram_quantile(0.95, rate(queue_processing_duration_seconds_bucket[5m]))` |
| **Latence SQL Server**             | Time series | `histogram_quantile(0.95, rate(db_connection_latency_seconds_bucket[5m]))` |
| **Erreurs connexion SQL Server**   | Time series | `rate(db_connection_errors_total[5m])`                        |
| **CPU container**                  | Time series | `rate(process_cpu_seconds_total[5m])`                         |
| **Memoire container (RSS)**        | Time series | `process_resident_memory_bytes`                               |
| **Heap Node.js**                   | Time series | `nodejs_heap_size_used_bytes` / `nodejs_heap_size_total_bytes`|
| **Event loop lag**                 | Time series | `nodejs_eventloop_lag_seconds`                                |
| **Handles actifs**                 | Time series | `nodejs_active_handles_total`                                 |
| **Requetes HTTP / min**            | Time series | `rate(http_requests_total[1m])` par `status`                  |
| **Latence HTTP P95**               | Time series | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))` |
| **Alertes declenchees (24h)**      | Time series | `increase(alerts_fired_total[24h])` par `rule`                |

---

## 11. Flux de synchronisation detaille

### 11.1. Sync incrementale (toutes les 2 minutes)

```
1. Lire `sync_metadata` (SQLite local) → recuperer `last_sync_at` pour chaque entite
2. Pour chaque entite (clients, articles, factures, reglements) :
   a. Requeter SQL Server :
      SELECT * FROM F_COMPTET WHERE cbModification > @lastSync
   b. Mapper les colonnes Sage → format JSON (snake_case)
   c. Construire le payload batch
   d. API-VPS accessible ?
      ├─ OUI → POST vers API-VPS /sync/receive/:entity
      │         ├─ Reponse OK → Logger succes, mettre a jour sync_metadata
      │         └─ Reponse PARTIAL → Logger les rejets, mettre a jour sync_metadata
      └─ NON → Ajouter chaque record a la queue locale SQLite
   e. Mettre a jour `sync_metadata.last_sync_at`
```

### 11.2. Sync complete — detection des suppressions (toutes les heures)

```
1. Pour chaque entite :
   a. Lire TOUS les identifiants actifs dans SQL Server
      SELECT CT_Num FROM F_COMPTET WHERE CT_Type = 0
   b. Envoyer la liste complete a API-VPS :
      POST /sync/receive/deletions
      { "entity_type": "client", "active_sage_ids": ["CLI001", "CLI002", ...] }
   c. API-VPS compare avec ses donnees et soft-delete les absents
   d. Mettre a jour `sync_metadata.last_full_sync_at`
```

### 11.3. Traitement de la queue (toutes les 30 secondes)

```
1. Ping API-VPS (GET /sync/health)
2. Si accessible :
   a. Lire les elements PENDING dans `sync_queue` (ordre chronologique)
   b. Regrouper par entity_type pour envoyer en batch
   c. Pour chaque batch :
      - POST vers API-VPS /sync/receive/:entity
      - Succes : marquer DONE
      - Echec : incrementer `attempts`
        ├─ attempts < max_attempts : remettre PENDING (retry plus tard)
        └─ attempts >= max_attempts : marquer FAILED + declencher alerte
3. Si non accessible :
   - Ne rien faire, reessayer dans 30 secondes
```

---

## 12. Gestion des erreurs

| Scenario                            | Comportement                                          |
|-------------------------------------|-------------------------------------------------------|
| SQL Server inaccessible             | Log erreur + alerte CRITICAL, skip le cycle, retry au prochain cron |
| API-VPS inaccessible                | Basculer en mode queue locale + alerte CRITICAL       |
| API-VPS repond 5xx                  | Alerte ERROR, stocker en queue pour retry              |
| API-VPS rejette des records (PARTIAL)| Logger les rejets, alerte WARNING si > 5% de rejet   |
| Erreur de mapping/donnees           | Log l'erreur, passer a l'enregistrement suivant       |
| Queue > 1 000 elements              | Alerte WARNING dans les logs                          |
| Queue > 5 000 elements              | Alerte CRITICAL dans les logs                         |
| Element en queue echoue 5x          | Marquer FAILED + alerte ERROR, ne plus retenter       |
| Conflit de donnees                  | La donnee Sage fait autorite (API-VPS ecrase)         |

---

## 13. Regles metier

1. **SQL Server est la source de verite** — Les donnees vont uniquement de Sage vers le VPS, jamais dans l'autre sens.
2. **API-LOCAL ne connait pas PostgreSQL** — Elle envoie du JSON a l'API-VPS, c'est tout.
3. **Les clients synchronises** sont uniquement ceux de type `CT_Type = 0` (Clients).
4. **Les factures synchronisees** sont uniquement du domaine Vente (`DO_Domaine = 0`) et de type Facture/Avoir (`DO_Type IN (6, 7)`).
5. **En cas de conflit**, la donnee la plus recente de SQL Server ecrase celle du VPS.
6. **Deduplication de la queue** : si un meme enregistrement est modifie plusieurs fois hors-ligne, seule la derniere version est conservee.
7. **Envoi par batch** : les records sont regroupes par entite pour minimiser les appels HTTP.

---

## 14. Structure du projet

```
API-LOCAL/
├── src/
│   ├── config/
│   │   ├── database.js          # Connexion SQL Server (mssql)
│   │   ├── sqlite.js            # Connexion SQLite (queue + metadata + alerts)
│   │   ├── vpsClient.js         # Client HTTP vers API-VPS (axios/fetch)
│   │   ├── prometheus.js        # Configuration prom-client + metriques custom
│   │   └── env.js               # Validation des variables d'environnement
│   │
│   ├── services/
│   │   ├── syncService.js       # Logique de synchronisation principale
│   │   ├── clientSync.js        # Sync specifique clients
│   │   ├── articleSync.js       # Sync specifique articles
│   │   ├── factureSync.js       # Sync specifique factures
│   │   ├── reglementSync.js     # Sync specifique reglements
│   │   ├── vpsService.js        # Envoi des payloads vers API-VPS + signature HMAC
│   │   ├── queueService.js      # Gestion de la file d'attente locale
│   │   ├── healthService.js     # Verification connectivite (SQL Server + API-VPS)
│   │   ├── alertService.js      # Evaluation des regles d'alerte + ecriture logs
│   │   ├── metricsService.js    # Enregistrement et mise a jour des metriques Prometheus
│   │   └── cronService.js       # Planification des taches
│   │
│   ├── controllers/
│   │   ├── syncController.js
│   │   ├── statusController.js
│   │   ├── queueController.js
│   │   └── alertController.js   # Endpoints alertes (liste, historique)
│   │
│   ├── routes/
│   │   ├── index.js
│   │   ├── sync.js
│   │   ├── status.js
│   │   ├── queue.js
│   │   └── alerts.js            # Routes alertes
│   │
│   ├── middlewares/
│   │   ├── apiKeyAuth.js        # Verification API Key (routes locales)
│   │   ├── rateLimiter.js       # Limitation de requetes
│   │   ├── metricsMiddleware.js # Collecte metriques HTTP (duree, status)
│   │   └── errorHandler.js      # Gestion centralisee des erreurs
│   │
│   ├── utils/
│   │   ├── logger.js            # Configuration Winston (app + alerts + sync)
│   │   ├── mapper.js            # Mapping Sage → JSON
│   │   └── hmac.js              # Signature HMAC-SHA256 des payloads
│   │
│   └── app.js                   # Point d'entree Express
│
├── monitoring/
│   ├── prometheus/
│   │   ├── prometheus.yml       # Configuration scraping Prometheus
│   │   └── alerts.yml           # Regles d'alerting Prometheus
│   │
│   └── grafana/
│       ├── provisioning/
│       │   ├── datasources/
│       │   │   └── prometheus.yml   # Auto-config datasource Prometheus
│       │   └── dashboards/
│       │       └── dashboards.yml   # Auto-chargement des dashboards
│       │
│       └── dashboards/
│           ├── overview.json        # Dashboard 1 — Vue d'ensemble
│           ├── sync-details.json    # Dashboard 2 — Sync & API-VPS
│           └── queue-infra.json     # Dashboard 3 — Queue & Infrastructure
│
├── data/
│   └── queue.sqlite             # Base SQLite locale (queue + sync_metadata + alert_history)
│
├── logs/                        # Fichiers de log (volume Docker)
│   ├── app.log                  # Logs applicatifs generaux
│   ├── sync.log                 # Logs detailles de synchronisation
│   ├── alerts.log               # Toutes les alertes
│   └── alerts-error.log         # Alertes ERROR et CRITICAL uniquement
│
├── Dockerfile                   # Image Docker de l'API
├── docker-compose.yml           # Stack complete (API + Prometheus + Grafana)
├── .dockerignore                # Fichiers exclus du build Docker
├── .env.example                 # Template des variables d'environnement
├── .gitignore
├── package.json
└── DOCUMENTATION.md
```

---

## 15. Variables d'environnement

```env
# === Application ===
NODE_ENV=production
PORT=3500
API_KEY=<cle-api-locale-longue-et-aleatoire>

# === SQL Server (Sage Bijou — source) ===
# Note : depuis le container Docker, utiliser l'IP du host ou host.docker.internal
MSSQL_HOST=host.docker.internal
MSSQL_PORT=1433
MSSQL_USER=<user>
MSSQL_PASSWORD=<password>
MSSQL_DATABASE=<nom_base_sage>

# === API-VPS (cible distante) ===
VPS_API_URL=https://<domaine-ou-ip-vps>/sync
SYNC_API_KEY=<cle-api-inter-api-64-caracteres>
SYNC_HMAC_SECRET=<secret-hmac-si-active>
SYNC_HMAC_ENABLED=false
SYNC_TIMEOUT=30000                    # timeout des appels VPS en ms
SYNC_BATCH_SIZE=100                   # nombre max de records par batch

# === Synchronisation ===
SYNC_INCREMENTAL_INTERVAL=2           # minutes
SYNC_FULL_INTERVAL=60                 # minutes
QUEUE_PROCESS_INTERVAL=30             # secondes
HEALTHCHECK_INTERVAL=30               # secondes

# === Alertes ===
ALERT_CHECK_INTERVAL=60               # secondes
ALERT_QUEUE_WARNING=1000              # seuil warning queue
ALERT_QUEUE_CRITICAL=5000             # seuil critical queue
ALERT_SYNC_LATENCY_MAX=60             # secondes avant alerte latence

# === Metriques ===
METRICS_ENABLED=true
METRICS_ALLOWED_IPS=127.0.0.1,::1,prometheus

# === Grafana ===
GRAFANA_USER=admin
GRAFANA_PASSWORD=<mot-de-passe-grafana>

# === CORS ===
CORS_ORIGINS=http://localhost:3000
```

---

## 16. Dependances du projet

| Package                       | Role                                            |
|-------------------------------|-------------------------------------------------|
| `express`                     | Framework HTTP                                  |
| `mssql`                       | Client SQL Server (requetes directes vers Sage) |
| `better-sqlite3`              | SQLite locale (queue + metadata + alerts)       |
| `axios`                       | Client HTTP pour appels vers API-VPS            |
| `node-cron`                   | Planification des taches                        |
| `prom-client`                 | Metriques Prometheus (collecte + exposition)    |
| `dotenv`                      | Variables d'environnement                       |
| `helmet`                      | Securite des headers HTTP                       |
| `cors`                        | Gestion CORS                                    |
| `morgan`                      | Logging HTTP                                    |
| `winston`                     | Logging applicatif structure                    |
| `winston-daily-rotate-file`   | Rotation automatique des fichiers de log        |
| `uuid`                        | Generation d'identifiants uniques               |

> **Supprime par rapport a l'ancienne architecture** : `sequelize`, `tedious`, `pg`, `pg-hstore` — API-LOCAL n'a plus besoin de driver PostgreSQL ni d'ORM.

---

## 17. Commandes

### 17.1. Docker (production)

```bash
# Demarrer toute la stack (API + Prometheus + Grafana)
docker compose up -d

# Voir les logs de l'API
docker compose logs -f api-local

# Voir les logs de tous les services
docker compose logs -f

# Rebuild apres modification du code
docker compose up -d --build api-local

# Arreter la stack
docker compose down

# Arreter et supprimer les volumes (reset complet)
docker compose down -v

# Verifier l'etat des containers
docker compose ps
```

**Acces aux services apres demarrage :**

| Service    | URL                        | Description                   |
|------------|----------------------------|-------------------------------|
| API        | `http://localhost:3500`    | API de synchronisation        |
| Prometheus | `http://localhost:9090`    | Interface Prometheus          |
| Grafana    | `http://localhost:3000`    | Dashboards de monitoring      |

### 17.2. Developpement local (sans Docker)

```bash
# Installation
pnpm install

# Demarrage en developpement
pnpm dev

# Demarrage en production
pnpm start
```
