# nikount — API REST

> Statut : **validé le 2026-11-08** (Phase 0). Les 🔶 renvoient aux décisions figées de [decisions.md](decisions.md). Préfixe : `/api/v1`. JSON uniquement.
> Les schémas exacts vivent dans `packages/contracts` (Zod) ; une spec OpenAPI est générée depuis eux.

## 1. Principes

- **Authentification** : `Authorization: Bearer <token>` (token participant ou admin).
  Le serveur en déduit `{ nikountId, role, adminId? }`. **Aucune route ne prend d'identifiant de nikount.**
- Les identifiants dans l'URL (`:id` d'opération, de participant…) sont **toujours** recherchés
  `WHERE nikount_id = <contexte> AND id = :id`. Hors périmètre → `404` (pas de fuite d'existence).
- Montants en **entiers d'unités mineures** (`12000` = 120,00 €).
- Schémas stricts : tout champ inconnu → `400`.
- Modifications concurrentes : le client envoie `version` ; écart → `409 VERSION_CONFLICT`.
- Création d'opération idempotente via `clientRequestId` (UUID généré à l'ouverture du formulaire).
- Pagination par curseur opaque (`?cursor=…&limit=50`).

### Format d'erreur

```json
{
  "error": {
    "code": "SPLIT_PERCENT_NOT_100",
    "message": "La somme des pourcentages doit être 100 %.",
    "details": { "sum": 9950 }
  },
  "requestId": "…"
}
```

| HTTP | Codes typiques                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`, `SPLIT_*`, `PAYER_INACTIVE`, `REIMBURSEMENT_SELF`                                               |
| 401  | `INVALID_TOKEN` (token inconnu, révoqué ou absent — message identique)                                              |
| 403  | `ADMIN_REQUIRED`                                                                                                    |
| 404  | `NOT_FOUND`                                                                                                         |
| 409  | `VERSION_CONFLICT`, `INVALID_STATE` (ex. dépense en `SETTLEMENT`), `INVALID_STATUS_TRANSITION`, `PENDING_REMAINING` |
| 429  | `RATE_LIMITED`                                                                                                      |
| 500  | `INTERNAL_ERROR`                                                                                                    |

## 2. Routes

Légende rôle : **P** participant, **A** admin, **—** public.

### Public

| Méthode | Route       | Rôle | Description                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ----------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET     | `/health`   | —    | Santé (inclut la connexion DB)                                                                                                                                                                                                                                                                                                                              |
| POST    | `/nikounts` | —    | Crée un nikount. Corps : `name`, `currency?` (ISO 4217, `EUR` par défaut), `adminLabel`, `adminIsParticipant?` (`true` par défaut : le créateur devient le premier participant), `participants[]` (≤ 100 noms, sans doublon, casse ignorée). Réponse **unique** contenant `participantToken` et `adminToken`. Limité à `RATE_LIMIT_CREATE_PER_HOUR` par IP. |

### Contexte

| Méthode | Route                              | Rôle | Description                                                                             |
| ------- | ---------------------------------- | ---- | --------------------------------------------------------------------------------------- |
| GET     | `/me`                              | P/A  | `{ role, admin?: { id, label, participantId }, nikount: {...} }` — appelé au chargement |
| GET     | `/nikount`                         | P/A  | Nom, devise, état, compteurs (dont `pendingCount`)                                      |
| PATCH   | `/nikount`                         | A    | `name`, `timezone`, `version`                                                           |
| POST    | `/nikount/state`                   | A    | `{ to, reason?, version }` — transitions de [product.md §4](product.md)                 |
| POST    | `/nikount/participant-link/rotate` | A    | Invalide l'ancien lien participant, renvoie le nouveau token                            |
| GET     | `/nikount/participant-link`        | A    | Réaffiche le lien participant (token déchiffré, D17)                                    |

### Participants

| Méthode | Route               | Rôle | Description                                                                                                                                                                                                                     |
| ------- | ------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET     | `/participants`     | P/A  | Actifs + inactifs (`isActive`), triés par `sortOrder`                                                                                                                                                                           |
| POST    | `/participants`     | A    | `{ name }` → 201. `409 PARTICIPANT_NAME_TAKEN` (nom actif déjà pris), `409 PARTICIPANT_LIMIT_REACHED` (200 max), `409 INVALID_STATE` (clôturé)                                                                                  |
| PATCH   | `/participants/:id` | A    | `{ name?, isActive?, sortOrder?, version }` (au moins un changement). Pas de suppression : désactivation. `404` hors de ce nikount, `409 VERSION_CONFLICT`, `409 PARTICIPANT_NAME_TAKEN` (renommage ou réactivation en doublon) |

### Admins

| Méthode | Route                | Rôle | Description                                                                    |
| ------- | -------------------- | ---- | ------------------------------------------------------------------------------ |
| GET     | `/admins`            | A    | Liste (sans tokens)                                                            |
| POST    | `/admins`            | A    | `{ label, participantId? }` → renvoie le **nouveau lien admin une seule fois** |
| POST    | `/admins/:id/revoke` | A    | Interdit sur le dernier admin actif ; un admin peut se révoquer lui-même       |

### Opérations

| Méthode | Route                        | Rôle | Description                                                                                                                         |
| ------- | ---------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| GET     | `/transactions`              | P/A  | Filtres : `type`, `status[]`, `payerId`, `participantId`, `q`, `from`, `to`, `category` ; tri : `occurredOn`, `amount`, `createdAt` |
| GET     | `/transactions/:id`          | P/A  | Détail + parts (`inputValue`, `amount`) + acteurs (libellés) + révisions                                                            |
| POST    | `/transactions`              | P/A  | Création (voir corps ci-dessous). P → `PENDING`, A → `VALIDATED`                                                                    |
| PUT     | `/transactions/:id`          | A    | Remplacement complet (montant, payeur, parts…) + `version` + `reason?` → nouvelle révision                                          |
| POST    | `/transactions/:id/validate` | A    | `PENDING → VALIDATED`                                                                                                               |
| POST    | `/transactions/:id/reject`   | A    | `PENDING → REJECTED`, `{ reason? }`                                                                                                 |
| POST    | `/transactions/:id/cancel`   | A    | `PENDING/VALIDATED → CANCELLED`, `{ reason? }`                                                                                      |
| POST    | `/transactions/bulk`         | A    | `{ action: "validate"\|"reject"\|"cancel", ids[] (≤ 200), reason? }` — **tout ou rien**                                             |

Corps de création :

```json
{
  "clientRequestId": "0193…",
  "type": "EXPENSE",
  "amount": 12000,
  "description": "Restaurant",
  "category": "FOOD",
  "occurredOn": "2026-09-28",
  "payerId": "…",
  "distribution": {
    "mode": "SHARES",
    "shares": [
      { "participantId": "…alice", "value": 1 },
      { "participantId": "…charlie", "value": 2 }
    ]
  },
  "declaredByParticipantId": "…bob"
}
```

Le client **n'envoie jamais** les montants calculés (sauf en mode `AMOUNT`, où ce sont les valeurs saisies) :
le serveur recalcule via `@nikount/core` et stocke le résultat. Réponse : l'opération complète, montants inclus.

### Soldes

| Méthode | Route       | Rôle | Description                                                                                                            |
| ------- | ----------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| GET     | `/balances` | P/A  | `{ balances: [{ participantId, balance }], nextPayerId, settlementSuggestions: [{ from, to, amount }], pendingTotal }` |

### Audit

| Méthode | Route    | Rôle | Description                          |
| ------- | -------- | ---- | ------------------------------------ |
| GET     | `/audit` | A    | Paginé, filtres `action`, `entityId` |

## 3. Évolutions prévues (hors MVP)

- `GET /transactions/export.csv` (A).
- `GET /nikount/join-qr` inutile : le QR est généré côté client à partir du lien.
- SSE `/events` pour rafraîchissement temps réel (MVP : rafraîchissement au focus + après mutation via TanStack Query).
