#!/bin/sh
# Premier démarrage de la base uniquement (docker-entrypoint-initdb.d) : crée le rôle applicatif,
# sans aucun droit DDL. Ses droits sur les tables sont (ré)appliqués à chaque migration
# (DATABASE_APP_ROLE, voir apps/api/src/db/migrate.ts).
set -eu

: "${POSTGRES_APP_USER:?POSTGRES_APP_USER est requis}"
: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD est requis}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set app_user="$POSTGRES_APP_USER" \
  --set app_password="$POSTGRES_APP_PASSWORD" \
  --set db="$POSTGRES_DB" <<'SQL'
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO :"app_user";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
