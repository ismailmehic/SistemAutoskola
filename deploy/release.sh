#!/usr/bin/env bash
set -Eeuo pipefail
umask 022
[[ $EUID == 0 && $# == 0 ]] || exit 64

root=/opt/driving-school
current="$root/current"
releases="$root/releases"
exec 9>/run/lock/driving-school-release.lock
flock 9
IFS= read -r revision
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Neispravan identifikator verzije.' >&2; exit 64; }
[[ ! -e "$current" || -L "$current" ]] || { echo 'Putanja aktivne verzije mora biti simbolička veza.' >&2; exit 1; }

previous=""
if [[ -L "$current" ]]; then
    previous="$(readlink -f -- "$current")"
    [[ "$previous" == "$releases/"* && -d "$previous" ]] || { echo 'Neispravna putanja aktivne verzije.' >&2; exit 1; }
fi

health_url=http://127.0.0.1:5080/api/auth/me
if [[ -r /etc/driving-school/health-url ]]; then
    IFS= read -r health_url < /etc/driving-school/health-url
fi
[[ "$health_url" =~ ^http://127\.0\.0\.1:[0-9]+/api/auth/me$ ]] || { echo 'Neispravna adresa provjere API-ja.' >&2; exit 1; }
stage="$(mktemp -d "$releases/.stage-$revision.XXXXXX")"
next="$root/.next-$BASHPID"
trap 'rm -rf -- "$stage"; rm -f -- "$next"' EXIT
chown driving-school:driving-school "$stage"
chmod 0755 "$stage"
runuser -u driving-school -- tar -xzf - -C "$stage" --no-same-owner --no-same-permissions
[[ -f "$stage/api/DrivingSchool.Api.dll" && -f "$stage/web/index.html" ]]
if [[ -n "$(find "$stage" -type l -print -quit)" ]]; then
    echo 'Paket ne smije sadržavati simboličke veze.' >&2
    exit 1
fi

release="$releases/$revision-${stage##*.}"
mv -T -- "$stage" "$release"

activate(){
    ln -s -- "$1" "$next" && mv -Tf -- "$next" "$current"
}

if [[ -n "$previous" && "$(systemctl show -p LoadState --value driving-school-backup.service)" == loaded ]]; then
    systemctl start driving-school-backup.service
fi

if [[ -n "$previous" ]]; then systemctl stop driving-school.service; fi
if ! systemd-run --quiet --wait --collect -p User=driving-school -p Group=driving-school \
    -p EnvironmentFile=/etc/driving-school/app.env -p WorkingDirectory="$release/api" \
    "$root/runtime/dotnet" "$release/api/DrivingSchool.Api.dll" --migrate; then
    if [[ -n "$previous" ]]; then systemctl start driving-school.service; fi
    echo 'Migracija nije uspjela.' >&2
    exit 1
fi

if ! activate "$release"; then
    if [[ -n "$previous" ]]; then systemctl start driving-school.service; fi
    exit 1
fi
ready=false
if systemctl restart driving-school.service; then
    for attempt in {1..30}; do
        if systemctl is-active --quiet driving-school.service &&
            [[ "$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' "$health_url")" == 401 ]]; then
            ready=true
            break
        fi
        sleep 1
    done
fi

if [[ "$ready" != true ]]; then
    if [[ -n "$previous" ]]; then
        activate "$previous"
        systemctl restart driving-school.service
    else
        systemctl stop driving-school.service
        unlink "$current"
    fi
    echo 'Nova verzija nije prošla provjeru API-ja.' >&2
    exit 1
fi

printf 'Objavljena verzija %s\n' "$revision"
