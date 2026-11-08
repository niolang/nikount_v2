#!/bin/sh
# Sauvegarde PostgreSQL (format custom de pg_dump, compressé), avec rotation.
#   backup.sh once   : une sauvegarde immédiate, puis sortie (test, avant une mise à jour)
#   backup.sh        : boucle, une sauvegarde par jour à BACKUP_HOUR (heure du conteneur, UTC)
# Variables : PGHOST, PGUSER, PGPASSWORD, PGDATABASE, BACKUP_DIR, BACKUP_KEEP_DAYS, BACKUP_HOUR.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
BACKUP_HOUR="${BACKUP_HOUR:-03}"

backup() {
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  target="$BACKUP_DIR/nikount-$stamp.dump"
  # Écrit d'abord dans un fichier temporaire : une sauvegarde interrompue n'est jamais
  # confondue avec une sauvegarde complète.
  pg_dump --format=custom --compress=9 --no-owner --file="$target.partial"
  pg_restore --list "$target.partial" >/dev/null
  mv "$target.partial" "$target"
  echo "$(date -u +%FT%TZ) sauvegarde OK : $target ($(du -h "$target" | cut -f1))"
  find "$BACKUP_DIR" -name 'nikount-*.dump' -type f -mtime +"$BACKUP_KEEP_DAYS" -print -delete
}

mkdir -p "$BACKUP_DIR"

if [ "${1:-}" = "once" ]; then
  backup
  exit 0
fi

echo "Sauvegarde quotidienne à ${BACKUP_HOUR}h (UTC), conservation ${BACKUP_KEEP_DAYS} jours."
while true; do
  if [ "$(date -u +%H)" = "$BACKUP_HOUR" ]; then
    backup || echo "$(date -u +%FT%TZ) ÉCHEC de la sauvegarde" >&2
    sleep 3600
  fi
  sleep 300
done
