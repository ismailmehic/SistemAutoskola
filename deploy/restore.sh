#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${DOCUMENT_DIR:? Putanja dokumenata u backupu}" "${BACKUP_WORK:? Putanja radnog direktorija u backupu}"
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD_FILE:?}"
snapshot="${1:?Navedite ID provjerenog snapshota.}"
target_db="${2:?Navedite naziv nove baze.}"
target_dir="${3:?Navedite novi apsolutni direktorij za dokumente.}"
[[ "$snapshot" =~ ^[[:xdigit:]]{8,64}$ && "$target_db" =~ ^[a-z][a-z0-9_]*$ && "$target_dir" = /* ]]
[[ "$target_db" != "${PGDATABASE:-}" && ! -e "$target_dir" && ! -L "$target_dir" ]]
stage="$(mktemp -d)"
trap 'rm -rf -- "$stage"' EXIT
restic dump "$snapshot" "$BACKUP_WORK/database.dump" > "$stage/database.dump"
mkdir -m 0700 -- "$stage/documents"
restic restore "$snapshot:$DOCUMENT_DIR" --target "$stage/documents" --verify
createdb "$target_db"
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
    --dbname="$target_db" "$stage/database.dump"
psql -X -v ON_ERROR_STOP=1 --dbname="$target_db" -Atc \
    "SELECT replace(\"StorageKey\"::text, '-', '') FROM \"Documents\" WHERE \"CandidateId\" IS NOT NULL
     UNION SELECT replace(\"Changes\"::jsonb->'StorageKey'->>'Previous', '-', '') FROM \"Audits\"
     WHERE \"Resource\" = 'document' AND \"Action\" = 'replace'" |
    while IFS= read -r key; do
        [[ "$key" =~ ^[a-f0-9]{32}$ && -f "$stage/documents/$key" ]] || { echo 'Nedostaje datoteka iz baze.' >&2; exit 1; }
    done
# Staging rows are short-lived and can expire while an online backup is copied.
psql -X -v ON_ERROR_STOP=1 --dbname="$target_db" -c 'DELETE FROM "Documents" WHERE "CandidateId" IS NULL; DELETE FROM "Sessions";'
mkdir -m 0700 -- "$target_dir"
cp -a -- "$stage/documents/." "$target_dir/"
printf '%s\n' 'Baza i dokumenti su vraćeni u zasebno odredište. Provjerite prijavu, preuzimanje dokumenata i izvoz registra.'
