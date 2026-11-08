# nikount

Gestion des dépenses partagées entre amis, groupes et associations — 100 % navigateur, sans compte.
**Un événement = un nikount = un lien privé.**

> Phases 0 (conception), 1 (socle), 2 (création et accès par lien), 3 (participants), 4 (opérations et répartitions), 5 (soldes), 6 (historique) et 7 (validation) en place — voir [docs/roadmap.md](docs/roadmap.md).

- [Tester en local](#tester-en-local)
- [Déployer en production](#déployer-en-production)
- [Commandes](#commandes) · [Organisation](#organisation) · [Documentation](#documentation)

---

## Tester en local

### Prérequis

- **Node.js 26 LTS** (version dans `.nvmrc`).
- **pnpm 10** : `npm install -g pnpm@10` (Node 26 n'embarque plus corepack).
- **Docker** : facultatif. Sans Docker, la base de données est [PGlite](https://pglite.dev), un vrai
  PostgreSQL 17 embarqué.

### 1. Installer

```bash
git clone https://github.com/niolang/nikount_v2.git nikount
cd nikount
pnpm install
cp .env.example .env
```

Générer la clé de chiffrement et la coller dans `.env` (`TOKEN_ENCRYPTION_KEY=`) :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 2a. Lancer sans Docker (PGlite)

Dans `.env`, faire pointer l'API vers la base locale :

```dotenv
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres
```

Puis, dans deux terminaux :

```bash
# Terminal 1 : base de données locale (données conservées dans .data/)
pnpm --filter @nikount/api db:local
```

```bash
# Terminal 2 : migrations (première fois et après chaque mise à jour), puis API + front
pnpm --filter @nikount/api db:migrate:dev
pnpm dev
```

### 2b. Lancer avec Docker

```bash
docker compose up
```

PostgreSQL, l'API (rechargement à chaud) et le front démarrent ensemble ; les migrations sont
appliquées automatiquement au démarrage de l'API.

### 3. Ouvrir

- Application : <http://localhost:5173> — créer un nikount, puis ouvrir le lien du groupe dans une
  fenêtre de navigation privée pour jouer le rôle d'un participant.
- Santé de l'API : <http://localhost:3000/api/v1/health> (ou le port `API_PORT` de `.env`).

Si le port 3000 est déjà pris, changer `API_PORT` **et** `VITE_API_PROXY_TARGET` dans `.env`
(ex. `3100` et `http://127.0.0.1:3100`).

### 4. Lancer les tests

```bash
pnpm test        # moteur comptable, contrats, API (sur un vrai PostgreSQL en mémoire), écrans
pnpm lint
pnpm typecheck
```

Aucun service à démarrer : les tests de l'API utilisent PGlite en mémoire.

---

## Déployer en production

L'application tourne sur **un seul serveur** avec Docker Compose (`docker-compose.prod.yml`) :

```
Internet ──HTTPS──► Caddy (web) ──► front statique
                        └──/api──► API Node (api) ──► PostgreSQL (db, non exposé)
```

Caddy obtient et renouvelle seul le certificat HTTPS (Let's Encrypt), pose les en-têtes de sécurité
(CSP, HSTS…) et masque les liens d'accès dans ses journaux.

### Prérequis

- Un serveur Linux (1 vCPU et 1 Go de RAM suffisent pour démarrer) avec **Docker Engine** et le
  plugin **Docker Compose**.
- Un **nom de domaine** dont l'enregistrement DNS `A` (et `AAAA` en IPv6) pointe vers le serveur.
- Ports **80** et **443** ouverts (80 sert à la validation du certificat et à la redirection HTTPS).
  Ne pas ouvrir 5432 : la base n'est joignable que depuis le réseau Docker interne.

### 1. Récupérer le code

```bash
git clone https://github.com/niolang/nikount_v2.git /opt/nikount
cd /opt/nikount
```

### 2. Configurer les secrets

```bash
cp .env.production.example .env
chmod 600 .env
openssl rand -base64 32   # → POSTGRES_PASSWORD
openssl rand -base64 32   # → TOKEN_ENCRYPTION_KEY
```

Remplir `.env` : `SITE_ADDRESS` (ex. `nikount.example.org`), `PUBLIC_BASE_URL`
(ex. `https://nikount.example.org`), `POSTGRES_PASSWORD`, `TOKEN_ENCRYPTION_KEY`.

> **Sauvegarder `TOKEN_ENCRYPTION_KEY` hors du serveur** (gestionnaire de mots de passe).
> Sans elle, les admins ne peuvent plus réafficher les liens du groupe (les liens restent valides).

### 3. Construire, migrer, démarrer

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml run --rm api node dist/db/migrate.js
docker compose -f docker-compose.prod.yml up -d
```

### 4. Vérifier

```bash
curl https://nikount.example.org/api/v1/health
# {"status":"ok","database":"up"}
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
```

Puis créer un nikount depuis le navigateur.

### Mettre à jour

```bash
cd /opt/nikount
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml run --rm api node dist/db/migrate.js
docker compose -f docker-compose.prod.yml up -d
```

Les migrations sont versionnées et ne s'appliquent qu'une fois ; les relancer est sans effet.

### Sauvegarder et restaurer la base

Sauvegarde (à planifier chaque jour, ex. par cron, et à copier hors du serveur) :

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "nikount-$(date +%F).dump"
```

Restauration (sur une base vide, API arrêtée) :

```bash
docker compose -f docker-compose.prod.yml stop api
docker compose -f docker-compose.prod.yml exec -T db \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < nikount-AAAA-MM-JJ.dump
docker compose -f docker-compose.prod.yml start api
```

### Bonnes pratiques

- Garder le système et Docker à jour ; n'exposer que les ports 80 et 443 (pare-feu).
- Ne jamais versionner `.env` ; une clé `TOKEN_ENCRYPTION_KEY` différente par environnement.
- Les journaux de Caddy et de l'API ne contiennent jamais les liens d'accès : on peut les
  transmettre pour un diagnostic.

> État : les images Docker sont construites et vérifiées par la CI GitHub à chaque push. Le
> déploiement de production n'a pas encore été éprouvé sur un vrai serveur (prévu en Phase 11).

---

## Commandes

| Commande                                       | Rôle                                                       |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `pnpm dev`                                     | API (rechargement à chaud) + front Vite                    |
| `pnpm test`                                    | Tous les tests (moteur, contrats, API sur PostgreSQL, web) |
| `pnpm lint` · `pnpm typecheck` · `pnpm format` | Qualité                                                    |
| `pnpm build`                                   | Build de production de tous les paquets                    |
| `pnpm --filter @nikount/api db:local`          | Base PostgreSQL locale (PGlite) sur le port 5433           |
| `pnpm --filter @nikount/api db:migrate:dev`    | Applique les migrations en développement                   |
| `pnpm --filter @nikount/api db:generate`       | Génère une migration SQL depuis `src/db/schema.ts`         |
| `pnpm --filter @nikount/api db:migrate`        | Applique les migrations (build de production)              |

## Organisation

```
apps/api            API Fastify (routes → services → repositories), Drizzle, migrations
apps/web            SPA React mobile-first (+ layout desktop admin)
packages/core       Moteur comptable PUR : montants, répartitions, soldes, transitions
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
