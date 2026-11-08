# nikount

Gestion des dépenses partagées entre amis, groupes et associations — 100 % navigateur, sans compte.
**Un événement = un nikount = un lien privé.**

> Phases 0 (conception), 1 (socle), 2 (création et accès par lien), 3 (participants) et 4 (opérations et répartitions) en place — voir [docs/roadmap.md](docs/roadmap.md).

## Démarrer

Prérequis : Node.js 26 LTS (`.nvmrc`) et pnpm 10.

```bash
pnpm install
cp .env.example .env
```

### Option A — sans Docker (PGlite)

[PGlite](https://pglite.dev) est un vrai PostgreSQL 17 embarqué, exposé sur le port 5433.
Dans `.env`, régler `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres` et
`TOKEN_ENCRYPTION_KEY` (commande de génération dans `.env.example`).

```bash
pnpm --filter @nikount/api db:local        # terminal 1 : base locale (données dans .data/)
pnpm --filter @nikount/api db:migrate:dev  # une fois, puis à chaque nouvelle migration
pnpm dev                                   # terminal 2 : API + front
```

### Option B — Docker Compose

```bash
docker compose up
```

Front : <http://localhost:5173> · API : <http://localhost:3000/api/v1/health> (ou le port `API_PORT` de `.env`).

## Commandes

| Commande                                       | Rôle                                                       |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `pnpm dev`                                     | API (rechargement à chaud) + front Vite                    |
| `pnpm test`                                    | Tous les tests (moteur, contrats, API sur PostgreSQL, web) |
| `pnpm lint` · `pnpm typecheck` · `pnpm format` | Qualité                                                    |
| `pnpm build`                                   | Build de production de tous les paquets                    |
| `pnpm --filter @nikount/api db:generate`       | Génère une migration SQL depuis `src/db/schema.ts`         |
| `pnpm --filter @nikount/api db:migrate`        | Applique les migrations (build de prod)                    |

## Organisation

```
apps/api            API Fastify (routes → services → repositories), Drizzle, migrations
apps/web            SPA React mobile-first (+ layout desktop admin)
packages/core       Moteur comptable PUR : montants, répartitions, soldes
packages/contracts  Schémas Zod partagés API ↔ front
docker/             Dockerfiles, Caddyfile (prod)
docs/               Conception
```

## Documentation

| Document                                     | Contenu                                                         |
| -------------------------------------------- | --------------------------------------------------------------- |
| [docs/decisions.md](docs/decisions.md)       | Décisions figées, règles métier, risques                        |
| [docs/product.md](docs/product.md)           | Vision, rôles, cycle de vie, règles métier, répartition, soldes |
| [docs/architecture.md](docs/architecture.md) | Stack, organisation du repo, écrans, déploiement                |
| [docs/data-model.md](docs/data-model.md)     | Schéma PostgreSQL, invariants, calcul des soldes                |
| [docs/api.md](docs/api.md)                   | Routes REST, authentification, erreurs                          |
| [docs/security.md](docs/security.md)         | Modèle de menace, tokens, IDOR, CSP, rate limiting, audit       |
| [docs/roadmap.md](docs/roadmap.md)           | Phases 0 → 11, critères de fin, stratégie de tests              |

## Déploiement

Voir `docker-compose.prod.yml` : PostgreSQL + API + Caddy (HTTPS automatique, en-têtes de sécurité,
logs sans tokens). Secrets uniquement via `.env`, jamais versionné.
