#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$HOME/.cache/pi-sync"
work=$(mktemp -d "$HOME/.cache/pi-sync/runtime-XXXXXX")
case "$work" in "$HOME"/.cache/pi-sync/runtime-*) ;; *) exit 1 ;; esac
archive=node-v24.12.0-linux-x64.tar.xz
for base in https://registry.npmmirror.com/-/binary/node/v24.12.0 https://mirrors.huaweicloud.com/nodejs/v24.12.0; do
  if curl --fail --location --connect-timeout 15 --max-time 120 "$base/$archive" -o "$work/$archive"; then break; fi
done
test -s "$work/$archive"
curl --fail --location --connect-timeout 15 --max-time 60 https://nodejs.org/dist/v24.12.0/SHASUMS256.txt -o "$work/SHASUMS256.txt"
awk -v file="$archive" '$2 == file {print}' "$work/SHASUMS256.txt" > "$work/checksum.txt"
test -s "$work/checksum.txt"
(cd "$work" && sha256sum --check checksum.txt)
tar -xJf "$work/$archive" -C "$work"
export PATH="$work/node-v24.12.0-linux-x64/bin:$PATH"
node --version
mkdir "$work/project"
tar -C /mnt/d/Personal/pi-plugins/packages/sync --exclude=node_modules -cf - package.json tsconfig.json src test | tar -C "$work/project" -xf -
cd "$work/project"
npm install --registry https://registry.npmmirror.com --no-audit --no-fund
export PATH="$work/project/node_modules/.bin:$PATH"
pi --version
printf '{"directory":"%s","project":"%s","node":"%s"}\n' "$work" "$work/project" "$work/node-v24.12.0-linux-x64/bin/node" > /mnt/d/Personal/pi-plugins/.scratch/pi-sync/linux-runtime.json
printf 'Linux runtime prepared: %s\n' "$work"
