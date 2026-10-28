#!/usr/bin/env bash
set -euo pipefail
trap 'printf "Linux verification failed at line %s\n" "$LINENO" >&2' ERR
runtime="${1:?runtime directory required}"
case "$runtime" in "$HOME"/.cache/pi-sync/runtime-*) ;; *) exit 1 ;; esac
test -d "$runtime/project/node_modules"
export PATH="$runtime/node-v24.12.0-linux-x64/bin:$runtime/project/node_modules/.bin:$PATH"
tar -C /mnt/d/Personal/pi-plugins/packages/sync --exclude=node_modules -cf - package.json tsconfig.json src test | tar -C "$runtime/project" -xf -
cd "$runtime/project"
npm run check
npm test
