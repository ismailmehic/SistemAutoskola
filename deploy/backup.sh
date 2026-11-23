#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${DOCUMENT_DIR:?}" "${BACKUP_WORK:?}" "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD_FILE:?}" "${PGDATABASE:?}"
[[ "$DOCUMENT_DIR" = /* && "$BACKUP_WORK" = /* && "$DOCUMENT_DIR" != / && "$BACKUP_WORK" != / ]]
[[ -d "$DOCUMENT_DIR" && -d "$BACKUP_WORK" ]]
cd "$BACKUP_WORK"
exec 9>backup.lock
flock -n 9
trap 'rm -f -- "$BACKUP_WORK/database.dump"' EXIT
pg_dump --no-owner --no-privileges --format=custom --file=database.dump
restic backup --tag driving-school --exclude '*.part' "$BACKUP_WORK/database.dump" "$DOCUMENT_DIR"
restic forget --tag driving-school --group-by host,paths,tags \
    --keep-daily "${BACKUP_KEEP_DAILY:-14}" --keep-weekly "${BACKUP_KEEP_WEEKLY:-8}" \
    --keep-monthly "${BACKUP_KEEP_MONTHLY:-12}" --prune
