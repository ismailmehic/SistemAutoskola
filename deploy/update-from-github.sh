#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

IFS= read -r repository < /etc/driving-school/github-repository
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]
url="https://github.com/$repository"
ref="$(GIT_TERMINAL_PROMPT=0 timeout 20 git ls-remote --exit-code "$url.git" refs/heads/main)"
revision="${ref%%$'\t'*}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]

active=""
if [[ -L /opt/driving-school/current ]]; then
    active="$(readlink -f -- /opt/driving-school/current)"
fi
if [[ "$active" == "/opt/driving-school/releases/$revision-"* ]]; then exit 0; fi

work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
base="$url/releases/download/build-$revision"
code="$(curl -sSL --retry 2 --max-time 30 -w '%{http_code}' -o "$work/release.sha256" "$base/release.sha256")"
if [[ "$code" == 404 ]]; then
    echo "Build $revision jos nije objavljen."
    exit 0
fi
[[ "$code" == 200 ]]
IFS= read -r digest < "$work/release.sha256"
[[ "$digest" =~ ^[0-9a-f]{64}$ ]] || { echo 'Neispravna kontrolna suma.' >&2; exit 1; }
curl -fsSL --retry 2 --max-time 180 --max-filesize 268435456 -o "$work/release.tar.gz" "$base/release.tar.gz"
printf '%s  %s\n' "$digest" "$work/release.tar.gz" | sha256sum -c -
{ printf '%s\n' "$revision"; cat "$work/release.tar.gz"; } | /usr/local/sbin/driving-school-release
