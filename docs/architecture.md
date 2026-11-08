# nikount — Architecture

> Statut : **validé le 2026-11-08** (Phase 0). Les 🔶 renvoient aux décisions figées de [decisions.md](decisions.md).

## 1. Choix de la stack

| Couche             | Choix                                                            | Pourquoi                                                                |
| ------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Langage            | **TypeScript partout** (strict)                                  | Un seul langage, types partagés front/back                              |
| Frontend           | React 19 + Vite 8 + TypeScript 6                                 | Demandé, écosystème standard                                            |
| Style              | Tailwind CSS v4 + petits composants maison                       | Rapide, mobile-first, pas de lib UI lourde                              |
| Routing            | React Router 8 (mode bibliothèque)                               | Simple, suffisant (pas de SSR)                                          |
| État serveur       | TanStack Query                                                   | Cache, invalidation, états de chargement/erreur                         |
| Formulaires        | React Hook Form + Zod                                            | Validation identique client/serveur                                     |
| Backend            | **Node.js 26 LTS + Fastify 5**                                   | Rapide, typé, plugins sécurité (rate-limit, helmet), logs pino intégrés |
| Validation         | **Zod** (schémas partagés) + `fastify-type-provider-zod`         | Une seule source de vérité des contrats, OpenAPI générée                |
| ORM / SQL          | **Drizzle ORM** + drizzle-kit                                    | SQL explicite, typé, migrations SQL versionnées et lisibles             |
| Base               | PostgreSQL 17 (PGlite en test et en local sans Docker)           | Demandé ; PGlite = vrai moteur PostgreSQL 17 embarqué, mêmes triggers   |
| Tests              | Vitest (+ fast-check pour les propriétés), Playwright (Phase 11) | Même outil front/back                                                   |
| Monorepo           | pnpm workspaces                                                  | Léger, pas besoin de Nx/Turborepo                                       |
| Reverse proxy prod | Caddy                                                            | HTTPS automatique, en-têtes de sécurité, sert le front statique         |

### Pourquoi Node + TypeScript plutôt que FastAPI

Le moteur comptable doit tourner **à deux endroits** :

- côté serveur, de façon **autoritaire** (c'est lui qui calcule et stocke les montants) ;
- côté client, pour **prévisualiser en direct** la répartition pendant la saisie (« Charlie 2 parts → 40 € »).

Avec TypeScript partout, c'est **le même code, les mêmes tests**. Avec FastAPI il faudrait le dupliquer
en Python et en TS, avec un risque de divergence — inacceptable sur la partie la plus critique.
Même logique pour les schémas de validation (Zod partagé).

## 2. Vue d'ensemble

```
 Navigateur (SPA React, mobile-first + layout desktop admin)
        │  HTTPS, Authorization: Bearer <token>
        ▼
 ┌───────────────┐   /           → fichiers statiques (build Vite)
 │    Caddy      │   /api/*      → reverse proxy
 └──────┬────────┘
        ▼
 ┌───────────────┐   Fastify : routes → services → repositories
 │   api (Node)  │   import @nikount/core (moteur comptable pur)
 └──────┬────────┘   import @nikount/contracts (schémas Zod)
        ▼
 ┌───────────────┐
 │  PostgreSQL   │   contraintes + triggers d'invariants
 └───────────────┘
```

**Monolithe modulaire**, un seul processus API, une seule base. Pas de microservices, pas de file
de messages, pas de cache distribué au MVP.

## 3. Organisation du repository

```
nikount/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── app.ts                 # construction de l'instance Fastify (testable)
│   │   │   ├── server.ts              # point d'entrée (listen)
│   │   │   ├── config.ts              # variables d'env validées par Zod
│   │   │   ├── auth/                  # résolution token → AccessContext, garde-fous de rôle
│   │   │   ├── db/
│   │   │   │   ├── schema.ts          # schéma Drizzle
│   │   │   │   ├── client.ts
│   │   │   │   └── migrations/        # SQL versionné (drizzle-kit + SQL manuel pour triggers)
│   │   │   ├── modules/
│   │   │   │   ├── nikounts/          # routes.ts / service.ts / repository.ts
│   │   │   │   ├── participants/
│   │   │   │   ├── admins/
│   │   │   │   ├── transactions/
│   │   │   │   ├── balances/
│   │   │   │   └── audit/
│   │   │   └── lib/                   # errors, tokens, logger, clock
│   │   └── test/                      # tests API (PostgreSQL réel via PGlite)
│   └── web/
│       ├── public/                    # manifest.webmanifest, icônes
│       └── src/
│           ├── main.tsx, router.tsx
│           ├── api/                   # client HTTP typé (contrats partagés)
│           ├── features/
│           │   ├── home/              # solde, à recevoir / à payer
│           │   ├── transactions/      # saisie, liste, détail
│           │   ├── reimbursements/
│           │   ├── participants/
│           │   └── admin/             # validation, desktop, paramètres, audit
│           ├── components/ui/         # Button, Sheet, AmountInput, Money, Badge…
│           └── lib/                   # format monétaire, stockage local, identité déclarée
├── packages/
│   ├── core/                          # ⚠ moteur comptable PUR (aucune I/O)
│   │   ├── src/money.ts               # centimes, parsing/format
│   │   ├── src/split.ts               # EQUAL / SHARES / PERCENT / AMOUNT + arrondi
│   │   ├── src/balances.ts            # soldes, invariants
│   │   ├── src/suggestions.ts         # qui paie la prochaine, virements suggérés
│   │   ├── src/rules.ts               # matrice états/statuts/permissions
│   │   └── test/                      # tests unitaires + tests de propriétés
│   └── contracts/                     # schémas Zod des requêtes/réponses API + enums
├── docker/
│   ├── api.Dockerfile
│   ├── web.Dockerfile                 # build Vite → image Caddy
│   └── Caddyfile
├── docker-compose.yml                 # dev : db + api (watch) + web (vite dev)
├── docker-compose.prod.yml            # prod : db + api + caddy
├── .env.example                       # aucune valeur secrète réelle
├── docs/
└── pnpm-workspace.yaml
```

### Couches côté API

| Couche          | Responsabilité                                                              | Interdit                           |
| --------------- | --------------------------------------------------------------------------- | ---------------------------------- |
| `routes.ts`     | HTTP : schémas Zod, extraction de l'`AccessContext`, codes de réponse       | Logique métier, SQL                |
| `service.ts`    | Règles métier, permissions, transactions DB, audit, appel à `@nikount/core` | Connaître Fastify                  |
| `repository.ts` | Requêtes SQL **toujours filtrées par `nikountId`** du contexte              | Décider des règles                 |
| `@nikount/core` | Calculs purs, déterministes                                                 | Toute I/O, `Date.now()`, aléatoire |

Toute écriture métier se fait dans **une transaction PostgreSQL** qui inclut l'écriture d'audit :
soit tout est enregistré, soit rien.

## 4. Accès par token (résumé, détails dans [security.md](security.md))

1. Le front lit le token dans l'URL (`/n/:token` ou `/a/:token`).
2. Chaque appel API envoie `Authorization: Bearer <token>`. **Aucun identifiant de nikount dans l'URL de l'API.**
3. Le plugin `auth` calcule `sha256(token)`, cherche la correspondance (lien participant ou accès admin
   non révoqué) et attache `request.access = { nikountId, role, adminId? }`.
4. Les services n'utilisent **que** `request.access.nikountId`. Un `nikount_id` envoyé par le client est ignoré
   (et les schémas Zod stricts le rejettent).

## 5. Frontend

### Routes

| Route                                                      | Écran                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/`                                                        | Accueil : « Créer un nikount » + liste « Mes nikounts » (localStorage)               |
| `/new`                                                     | Création (nom, devise, mon nom d'admin, participants initiaux) → écran « Vos liens » |
| `/n/:token`                                                | Accueil participant (solde, à recevoir/à payer, actions, historique récent)          |
| `/n/:token/expenses`, `/n/:token/reimbursements`           | Onglets                                                                              |
| `/n/:token/tx/:id`                                         | Détail d'une opération                                                               |
| `/n/:token/menu`                                           | Participants, partager le lien, « changer d'identité », état                         |
| `/a/:token/...`                                            | Mêmes écrans + fonctions admin ; en ≥ `lg`, layout desktop avec barre latérale       |
| `/a/:token/review`                                         | Opérations à valider                                                                 |
| `/a/:token/operations`                                     | Table dense (desktop)                                                                |
| `/a/:token/participants`, `/admins`, `/settings`, `/audit` | Gestion                                                                              |

Un seul SPA : **l'interface desktop admin est un layout, pas une deuxième application**. Les composants
métier (formulaire d'opération, détail, soldes) sont partagés.

### Principes mobile

- Barre de navigation basse : **Accueil · Dépenses · Remboursements · Menu** ; bouton d'action principal
  « + Dépense » dans la zone du pouce.
- Saisie dans une _bottom sheet_ plein écran : montant (clavier numérique `inputmode="decimal"`) →
  description → payeur (moi par défaut) → concernés (tous cochés par défaut) → « Répartition avancée » repliée.
- Prévisualisation instantanée de la répartition via `@nikount/core`.
- Montant affiché avec `Intl.NumberFormat('fr-FR', { style: 'currency' })`.

### Données locales (navigateur)

`localStorage` contient uniquement : la liste des nikounts récents (nom, rôle, token), et l'identité
déclarée par nikount. Aucun autre état métier n'est persisté localement.

## 6. Écrans principaux (maquettes texte)

**Accueil participant (mobile)**

```
┌─────────────────────────────┐
│ Weekend Chamonix   [En cours]│
│                              │
│ TON SOLDE (Bob)              │
│ −42,50 €                     │
│                              │
│ À RECEVOIR                   │
│ Alice          +124,50 €     │
│ David           +32,00 €     │
│ À PAYER                      │
│ Bob             −42,00 €     │
│ Charlie         −82,50 €     │
│                              │
│ Qui paie la prochaine ? → Charlie │
│                              │
│ [ + Ajouter une dépense ]    │
│ [ 💸 Remboursement ]         │
│                              │
│ Aujourd'hui                  │
│ 🍕 Restaurant · Alice  120 € │
│ ⛽ Essence · Bob  68 € ⏳     │
├─────────────────────────────┤
│ Accueil Dépenses Rembours. Menu │
└─────────────────────────────┘
```

**Admin mobile** : même accueil + bannière `3 dépenses à valider ›` → liste avec
« Valider » / « Refuser » par ligne et « Valider tout ».

**Admin desktop**

```
┌──────────┬──────────────────────────────────────────────────────────┐
│ Tableau  │ Opérations   [Recherche…] [Type▾][Statut▾][Payeur▾][Dates]│
│ À valider│ ☐ Date   Description  Payeur  Concernés  Montant  Statut  │
│ Opérations│ ☐ 28/09 Restaurant   Alice   4          120,00  Validée │
│ Particip.│ ☑ 28/09 Essence      Bob     4           68,00  Attente │
│ Admins   │ ☑ 27/09 Courses      David   3           45,00  Attente │
│ Paramètres│ 2 sélectionnées : [Valider] [Refuser] [Annuler]         │
│ Audit    │                                     panneau détail ▸    │
└──────────┴──────────────────────────────────────────────────────────┘
```

Édition inline : description, date, catégorie. Montant / payeur / répartition : panneau latéral
(formulaire complet, car la répartition dépend du montant).

## 7. Erreurs et logs

- Erreurs métier typées (`DomainError` avec `code`) → format de réponse unique (voir [api.md](api.md)).
- Erreurs inattendues → 500 générique, détail uniquement dans les logs, corrélé par `requestId`.
- Logs JSON (pino) : `requestId`, route, statut, durée, `nikountId`, rôle. **Jamais de token**
  (en-tête `Authorization` masqué, chemins `/n/*` et `/a/*` masqués dans les logs Caddy).

## 8. Déploiement

- **Dev** : `docker compose up` → `db` (Postgres), `api` (tsx watch), `web` (Vite dev server, proxy `/api`).
- **Prod** : `docker-compose.prod.yml` → `db`, `api` (image Node distroless/alpine, utilisateur non-root),
  `web` (Caddy servant le build + proxy `/api` + TLS automatique).
- Migrations exécutées par une commande dédiée (`pnpm --filter api db:migrate`) au démarrage du déploiement,
  pas implicitement par chaque instance.
- Configuration par variables d'environnement (`DATABASE_URL`, `PUBLIC_BASE_URL`, `LOG_LEVEL`,
  `TRUST_PROXY`, `RATE_LIMIT_*`). `.env` ignoré par Git, `.env.example` versionné.
- Sauvegardes : `pg_dump` quotidien (script fourni), à brancher sur le stockage de l'hébergeur.

## 9. Extensibilité prévue (sans coût au MVP)

| Besoin futur         | Ce qui est déjà prêt                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| QR code              | Le lien participant est l'unique « clé de jonction » : un QR = ce lien, généré côté client. Aucune API à ajouter                    |
| PWA                  | Manifest + icônes dès Phase 1 ; page `/` liste les nikounts récents (l'app installée s'ouvre sur `/`) ; `vite-plugin-pwa` ajoutable |
| Comptes utilisateurs | Les accès sont déjà une table (`admin_access`) : un compte pourra « posséder » des accès                                            |
| Multi-devises        | `currency` stocké sur le nikount ; montants toujours en unités mineures                                                             |
| Scalabilité          | API sans état : plusieurs instances possibles (rate limit → Redis le jour venu)                                                     |
