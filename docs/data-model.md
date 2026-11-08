# nikount — Modèle de données

> Statut : **validé le 2026-11-08** (Phase 0). Les 🔶 renvoient aux décisions figées de [decisions.md](decisions.md). PostgreSQL 17.

## 1. Conventions

- Clés primaires `uuid` (v7, générées côté serveur). **Les UUID ne sont jamais une autorisation** :
  toute lecture/écriture est filtrée par le `nikount_id` issu du token.
- Montants : `bigint` en **unités mineures** (centimes). Jamais de `float`, jamais de `numeric` pour les montants.
- Horodatages `timestamptz` (UTC). Dates métier `date`.
- Enums PostgreSQL pour les statuts.
- **Clés étrangères composites `(nikount_id, id)`** : la base elle-même empêche qu'une opération
  du nikount A référence un participant du nikount B (défense en profondeur contre l'IDOR).
- Colonne `version int` sur les entités modifiables → verrouillage optimiste (conflit = HTTP 409).

## 2. Schéma

```
nikount 1───* participant
   │  1───* admin_access ───0..1 participant
   │  1───* transaction 1───* transaction_share *───1 participant
   │                    1───* transaction_revision
   └  1───* audit_event
```

### `nikount`

| Colonne                      | Type                 | Notes                                                                                         |
| ---------------------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| id                           | uuid PK              |                                                                                               |
| name                         | text                 | 1–60 car.                                                                                     |
| currency                     | char(3)              | `EUR` par défaut, immuable après la 1re opération                                             |
| timezone                     | text                 | `Europe/Paris` par défaut (pour « aujourd'hui »)                                              |
| state                        | enum `nikount_state` | `OPEN` \| `SETTLEMENT` \| `CLOSED`                                                            |
| state_changed_at             | timestamptz          |                                                                                               |
| participant_token_hash       | bytea UNIQUE         | `sha256(token)` — le token en clair n'est **jamais** stocké 🔶D1                              |
| participant_token_ciphertext | bytea                | Token chiffré AES-256-GCM (iv ‖ tag ‖ chiffré), contexte = id du nikount, clé hors base 🔶D17 |
| participant_token_rotated_at | timestamptz          |                                                                                               |
| version                      | int                  |                                                                                               |
| created_at, updated_at       | timestamptz          |                                                                                               |

### `participant`

| Colonne                | Type        | Notes                                                                                |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------ |
| id                     | uuid PK     | UNIQUE `(nikount_id, id)` pour les FK composites                                     |
| nikount_id             | uuid FK     |                                                                                      |
| name                   | text        | 1–40 car., normalisé NFC, trim ; UNIQUE `(nikount_id, lower(name))` parmi les actifs |
| is_active              | boolean     | Désactivation au lieu de suppression                                                 |
| sort_order             | int         | Ordre d'affichage et de départage des arrondis                                       |
| version                | int         |                                                                                      |
| created_at, updated_at | timestamptz |                                                                                      |

### `admin_access`

Un lien admin = une ligne. Permet plusieurs admins, la révocation individuelle et l'attribution
nominative des actions.

| Colonne             | Type             | Notes                                                                                                                                     |
| ------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| id                  | uuid PK          |                                                                                                                                           |
| nikount_id          | uuid FK          |                                                                                                                                           |
| label               | text             | Nom affiché (« Nicolas »)                                                                                                                 |
| participant_id      | uuid NULL        | _(ajouté en Phase 3 avec la table `participant`)_ FK composite ; lien optionnel vers un participant (un trésorier peut ne pas participer) |
| token_hash          | bytea UNIQUE     | `sha256(token)`                                                                                                                           |
| created_by_admin_id | uuid NULL        | NULL pour le créateur du nikount                                                                                                          |
| revoked_at          | timestamptz NULL | Révoqué = refusé immédiatement                                                                                                            |
| last_used_at        | timestamptz NULL | Mis à jour au plus 1×/min                                                                                                                 |
| created_at          | timestamptz      |                                                                                                                                           |

Règle : il reste toujours **au moins un accès admin non révoqué** (on ne peut pas révoquer le dernier).

### `transaction`

| Colonne                                                    | Type        | Notes                                                            |
| ---------------------------------------------------------- | ----------- | ---------------------------------------------------------------- |
| id                                                         | uuid PK     | UNIQUE `(nikount_id, id)`                                        |
| nikount_id                                                 | uuid FK     |                                                                  |
| type                                                       | enum        | `EXPENSE` \| `REIMBURSEMENT`                                     |
| status                                                     | enum        | `PENDING` \| `VALIDATED` \| `REJECTED` \| `CANCELLED`            |
| amount                                                     | bigint      | CHECK `amount > 0 AND amount <= 100000000`                       |
| description                                                | text        | 1–80 car.                                                        |
| category                                                   | enum NULL   | `FOOD`, `TRANSPORT`, `GROCERIES`, `LODGING`, `ACTIVITY`, `OTHER` |
| occurred_on                                                | date        |                                                                  |
| payer_id                                                   | uuid        | FK composite `(nikount_id, payer_id)` → participant              |
| distribution_mode                                          | enum        | `EQUAL` \| `SHARES` \| `PERCENT` \| `AMOUNT`                     |
| created_by_kind                                            | enum        | `ADMIN` \| `PARTICIPANT`                                         |
| created_by_admin_id                                        | uuid NULL   | si admin                                                         |
| declared_by_participant_id                                 | uuid NULL   | identité déclarée (participant) — informative                    |
| client_request_id                                          | uuid        | **idempotence** : UNIQUE `(nikount_id, client_request_id)`       |
| validated_at / validated_by_admin_id                       | NULL        |                                                                  |
| rejected_at / rejected_by_admin_id / rejection_reason      | NULL        |                                                                  |
| cancelled_at / cancelled_by_admin_id / cancellation_reason | NULL        |                                                                  |
| version                                                    | int         | Incrémentée à chaque modification                                |
| created_at, updated_at                                     | timestamptz |                                                                  |

Contraintes :

- CHECK cohérence statut ↔ colonnes (`status = 'VALIDATED'` ⇒ `validated_at IS NOT NULL`, etc.).
- CHECK `type = 'REIMBURSEMENT'` ⇒ `distribution_mode = 'EQUAL'`.
- **Trigger `BEFORE DELETE` qui lève une exception** : aucune suppression physique possible, même par erreur de code.

### `transaction_share`

| Colonne        | Type          | Notes                                                                                                |
| -------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| id             | uuid PK       |                                                                                                      |
| transaction_id | uuid          | FK composite `(nikount_id, transaction_id)`                                                          |
| nikount_id     | uuid          | dénormalisé pour les FK composites et les index                                                      |
| participant_id | uuid          | FK composite → participant                                                                           |
| input_value    | numeric(12,2) | `EQUAL` : 1 ; `SHARES` : nb de parts ; `PERCENT` : % (25.00) ; `AMOUNT` : montant en unités mineures |
| amount         | bigint        | CHECK `amount >= 0` — **montant final calculé et figé**                                              |

- UNIQUE `(transaction_id, participant_id)`.
- **Trigger de contrainte `DEFERRABLE INITIALLY DEFERRED`** : à la fin de chaque transaction SQL,
  vérifie `Σ share.amount = transaction.amount` et `count(shares) ≥ 1` (`= 1` pour un remboursement,
  et participant ≠ payeur). Le moteur et le service le garantissent déjà ; la base est le dernier filet.
- Les lignes de parts d'une opération sont **remplacées** lors d'une modification (l'ancienne version
  vit dans `transaction_revision`). Ce n'est pas une suppression d'opération financière.

### `transaction_revision`

Instantané complet à chaque création et modification — permet d'afficher « ce qui a changé ».

| Colonne                                                            | Type        | Notes                                                        |
| ------------------------------------------------------------------ | ----------- | ------------------------------------------------------------ |
| id                                                                 | uuid PK     |                                                              |
| transaction_id                                                     | uuid        |                                                              |
| nikount_id                                                         | uuid        |                                                              |
| revision                                                           | int         | 1, 2, 3… UNIQUE `(transaction_id, revision)`                 |
| snapshot                                                           | jsonb       | transaction + parts (schéma Zod versionné `snapshotVersion`) |
| changed_by_kind / changed_by_admin_id / declared_by_participant_id |             |                                                              |
| reason                                                             | text NULL   |                                                              |
| created_at                                                         | timestamptz |                                                              |

Les changements de statut (validation, annulation…) ne créent pas de révision : ils sont dans les colonnes
dédiées et dans l'audit.

### `audit_event` (append-only)

| Colonne                 | Type             | Notes                                                                                                                    |
| ----------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| id                      | bigint identity  | interne, jamais exposé comme clé d'accès                                                                                 |
| nikount_id              | uuid             |                                                                                                                          |
| occurred_at             | timestamptz      |                                                                                                                          |
| actor_kind              | enum             | `ADMIN` \| `PARTICIPANT` \| `SYSTEM`                                                                                     |
| actor_admin_id          | uuid NULL        |                                                                                                                          |
| actor_participant_id    | uuid NULL        | déclaré                                                                                                                  |
| action                  | text             | ex. `transaction.created`, `transaction.validated`, `nikount.state_changed`, `admin.revoked`, `participant_link.rotated` |
| entity_type / entity_id | text / uuid NULL |                                                                                                                          |
| data                    | jsonb            | avant/après pertinents, motif                                                                                            |
| request_id              | text             | corrélation logs                                                                                                         |

- Triggers `BEFORE UPDATE OR DELETE` qui lèvent une exception.
- Index `(nikount_id, occurred_at DESC)`.

## 3. Index principaux

- `transaction (nikount_id, status)`, `transaction (nikount_id, occurred_on DESC, created_at DESC)`
- `transaction_share (nikount_id, participant_id)`
- Recherche desktop : `transaction (nikount_id)` + `ILIKE` suffit au volume attendu (< 1 000 opérations / nikount).
  `pg_trgm` si besoin plus tard.

## 4. Calcul des soldes

Calculé **à la lecture**, sans table de soldes (pas de cache à désynchroniser) :

```sql
WITH paid AS (
  SELECT payer_id AS participant_id, SUM(amount) AS total
  FROM transaction
  WHERE nikount_id = $1 AND status = 'VALIDATED'
  GROUP BY payer_id
), owed AS (
  SELECT s.participant_id, SUM(s.amount) AS total
  FROM transaction_share s
  JOIN transaction t ON t.id = s.transaction_id AND t.nikount_id = s.nikount_id
  WHERE s.nikount_id = $1 AND t.status = 'VALIDATED'
  GROUP BY s.participant_id
)
SELECT p.id, COALESCE(paid.total,0) - COALESCE(owed.total,0) AS balance
FROM participant p
LEFT JOIN paid ON paid.participant_id = p.id
LEFT JOIN owed ON owed.participant_id = p.id
WHERE p.nikount_id = $1;
```

En parallèle, `@nikount/core` expose `computeBalances(transactions)` qui fait le même calcul en mémoire.
Les tests API vérifient que **SQL et moteur donnent le même résultat** sur des jeux de données générés,
et que `Σ soldes = 0`.

## 5. Exemple

`Restaurant` 120,00 € payé par Alice, `SHARES` :

```
transaction        amount=12000 payer=Alice mode=SHARES status=VALIDATED
transaction_share  Alice   input=1  amount=2000
                   Bob     input=1  amount=2000
                   Charlie input=2  amount=4000
                   David   input=2  amount=4000
```

Soldes : Alice +100,00 (12000 − 2000), Bob −20,00, Charlie −40,00, David −40,00 → somme = 0.
