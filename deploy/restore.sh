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
     WHERE \"Resource\" = 'document' AND \"Action\" = 'replace'" > "$stage/required-keys"
# Both the original flat layout and the named candidate layout preserve the immutable storage key.
find "$stage/documents" -type f -printf '%f\n' |
    cut -d- -f1 | LC_ALL=C sort -u > "$stage/restored-keys"
LC_ALL=C sort -u "$stage/required-keys" -o "$stage/required-keys"
LC_ALL=C comm -23 "$stage/required-keys" "$stage/restored-keys" > "$stage/missing-keys"
[[ ! -s "$stage/missing-keys" ]] || { echo 'Nedostaje datoteka iz baze.' >&2; exit 1; }
# Staging rows are short-lived and can expire while an online backup is copied.
psql -X -v ON_ERROR_STOP=1 --dbname="$target_db" -c 'DELETE FROM "Documents" WHERE "CandidateId" IS NULL; DELETE FROM "Sessions";'
mkdir -m 0700 -- "$target_dir"
cp -a -- "$stage/documents/." "$target_dir/"
printf '%s\n' 'Baza i dokumenti su vraćeni u zasebno odredište. Provjerite prijavu, preuzimanje dokumenata i izvoz registra.'
