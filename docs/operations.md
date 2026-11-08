# nikount — Exploitation

> Pour la personne qui héberge nikount. Un seul serveur, Docker Compose, aucune autre dépendance.
> Chaque procédure de ce document est rejouée par la CI à chaque push (job « Pile de production »).

## 1. Architecture déployée

```
Internet ──HTTPS──► web (Caddy) ──► front statique (build Vite)
                        └──/api──► api (Node, utilisateur non-root, système de fichiers en lecture seule)
                                       └──► db (PostgreSQL 17, aucun port publié)
                    backup ──pg_dump quotidien──► ./backups (dossier de l'hôte)
```

| Service   | Rôle                                                                          | Données persistantes                   |
| --------- | ----------------------------------------------------------------------------- | -------------------------------------- |
| `db`      | PostgreSQL 17                                                                 | volume `db-data`                       |
| `api`     | API Fastify, rôle PostgreSQL `nikount_app` **sans droits DDL**                | aucune                                 |
| `web`     | Caddy : HTTPS automatique, en-têtes de sécurité, front, proxy `/api`          | volumes `caddy-data` (certificats)     |
| `backup`  | `pg_dump` chaque jour, rotation                                               | `./backups` (à copier hors du serveur) |
| `migrate` | Tâche ponctuelle (profil `tools`) : migrations + droits du rôle `nikount_app` | aucune                                 |

Deux rôles PostgreSQL : le **propriétaire** (`POSTGRES_USER`, migrations et sauvegardes) et le
**rôle applicatif** (`POSTGRES_APP_USER`, utilisé par l'API) qui peut lire et écrire mais ne peut ni
modifier la structure, ni effacer l'historique (audit et révisions en ajout seul). Les droits sont
réappliqués à chaque migration.

## 2. Premier déploiement

Prérequis : un serveur Linux (1 vCPU, 1 Go de RAM suffisent) avec Docker Engine et le plugin
Compose ; un nom de domaine dont les enregistrements DNS `A`/`AAAA` pointent vers le serveur ; ports
80 et 443 ouverts, **et eux seuls**.

```bash
git clone https://github.com/niolang/nikount_v2.git /opt/nikount && cd /opt/nikount
cp .env.production.example .env && chmod 600 .env
openssl rand -hex 24      # → POSTGRES_PASSWORD
openssl rand -hex 24      # → POSTGRES_APP_PASSWORD (différent)
openssl rand -base64 32   # → TOKEN_ENCRYPTION_KEY
```

Remplir `.env` (`SITE_ADDRESS`, `PUBLIC_BASE_URL` en `https://`, les trois secrets), puis :

```bash
alias dc='docker compose -f docker-compose.prod.yml'
dc --profile tools build
dc up -d --wait db          # 1er démarrage : crée aussi le rôle nikount_app
dc run --rm migrate         # schéma + droits du rôle applicatif
dc up -d --wait             # api, web, backup
curl -fsS https://nikount.example.org/api/v1/health   # {"status":"ok","database":"up"}
```

> **Copier `.env` (au minimum `TOKEN_ENCRYPTION_KEY`) dans un gestionnaire de mots de passe.**
> Sans cette clé, les admins ne peuvent plus réafficher le lien du groupe (il reste valide ; un
> admin peut en générer un nouveau). Les sauvegardes de la base ne contiennent pas cette clé.

## 3. Mettre à jour

```bash
cd /opt/nikount && git pull
dc --profile tools build
dc exec backup sh /usr/local/bin/backup.sh once   # filet de sécurité avant migration
dc run --rm migrate
dc up -d --wait
```

Les migrations sont versionnées et appliquées une seule fois : relancer `migrate` est sans effet.
Coupure : quelques secondes pendant le redémarrage de l'API (pas de déploiement sans interruption
au MVP).

## 4. Sauvegardes

- Le service `backup` fait un `pg_dump` (format custom, compressé) chaque jour à `BACKUP_HOUR`
  (UTC, défaut 03 h), vérifie que le fichier est lisible (`pg_restore --list`), puis supprime ceux
  de plus de `BACKUP_KEEP_DAYS` jours (défaut 14).
- Sauvegarde immédiate : `dc exec backup sh /usr/local/bin/backup.sh once`.
- **Les fichiers restent sur le serveur** : les copier ailleurs chaque jour, par exemple
  `rsync -a /opt/nikount/backups/ sauvegarde@autre-machine:nikount/` depuis un cron, ou un outil
  comme restic/borg. Une sauvegarde sur la même machine ne protège pas d'une perte du serveur.
- Suivi : `dc logs backup` affiche « sauvegarde OK » ou « ÉCHEC de la sauvegarde ».

### Restaurer

Toujours tester d'abord dans une base à part (c'est ce que fait la CI) :

```bash
dc exec -T db createdb -U nikount restore_check
dc exec -T db pg_restore -U nikount -d restore_check --no-owner < backups/nikount-AAAAMMJJTHHMMSSZ.dump
dc exec -T db psql -U nikount -d restore_check -c 'select count(*) from nikount'
dc exec -T db dropdb -U nikount restore_check
```

Restauration réelle (remplace toutes les données ; API arrêtée) :

```bash
dc stop api
dc exec backup sh /usr/local/bin/backup.sh once     # garder l'état actuel, au cas où
dc exec -T db pg_restore -U nikount -d nikount --clean --if-exists --no-owner < backups/<fichier>.dump
dc run --rm migrate                                 # réapplique les droits du rôle applicatif
dc start api
```

## 5. Surveiller

| Quoi                | Comment                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Disponibilité       | `GET /api/v1/health` (200 si l'API et la base répondent, 503 sinon) : à brancher sur une sonde externe (Uptime Kuma, UptimeRobot…) |
| État des conteneurs | `dc ps` (l'API a un healthcheck ; Caddy attend qu'elle soit saine)                                                                 |
| Journaux            | `dc logs -f api` (JSON, un `x-request-id` par requête), `dc logs -f web`                                                           |
| Disque              | volume `db-data` et dossier `backups/` (`du -sh`)                                                                                  |
| Certificat          | renouvelé automatiquement par Caddy ; erreurs visibles dans `dc logs web`                                                          |

Les journaux ne contiennent **jamais** les liens d'accès (chemins `/n/…` et `/a/…` masqués par
Caddy, en-tête `Authorization` masqué par l'API) : on peut les transmettre pour un diagnostic. Ils
contiennent les adresses IP : rotation à 5 × 10 Mo par service.

## 6. Limites et réglages

Variables facultatives de `.env` (puis `dc up -d api`) :

| Variable                       | Défaut | Effet                                                          |
| ------------------------------ | ------ | -------------------------------------------------------------- |
| `RATE_LIMIT_CREATE_PER_HOUR`   | 10     | Créations de nikount par IP et par heure                       |
| `RATE_LIMIT_WRITES_PER_MINUTE` | 60     | Écritures par lien admin (lien du groupe : par lien et par IP) |
| `RATE_LIMIT_READS_PER_MINUTE`  | 300    | Lectures, même découpage                                       |
| `AUTH_FAILURE_MAX`             | 20     | Liens invalides tolérés par IP en 10 min, puis blocage 15 min  |
| `LOG_LEVEL`                    | info   | `warn` pour des journaux plus discrets                         |

Les compteurs sont en mémoire : ils repartent de zéro au redémarrage de l'API, et supposent une
**instance unique** (pas de mise à l'échelle horizontale au MVP).

## 7. Incidents

| Situation                              | Réponse                                                                                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lien du groupe diffusé trop largement  | Un admin : Gestion → « Nouveau lien du groupe » (l'ancien cesse immédiatement de fonctionner)                                                                                    |
| Lien admin compromis                   | Un autre admin le révoque (Gestion → Administrateurs). Seul admin : pas de récupération au MVP (D11)                                                                             |
| Abus (créations en masse, force brute) | Les limites répondent 429 ; au besoin, bloquer l'IP au pare-feu                                                                                                                  |
| Opération litigieuse                   | Journal (écran « Journal », ou `audit_event`) : qui, quoi, quand, avant/après                                                                                                    |
| `.env` perdu, base intacte             | Nouveaux mots de passe : `ALTER ROLE … PASSWORD` via `dc exec db psql -U nikount`. `TOKEN_ENCRYPTION_KEY` perdue : liens du groupe non réaffichables, à régénérer par les admins |
| Serveur perdu                          | Nouveau serveur (§2), restaurer la dernière sauvegarde (§4), remettre le même `.env`                                                                                             |
| Faille dans une dépendance             | Dependabot ouvre une PR ; la CI exécute `pnpm audit` à chaque push                                                                                                               |
