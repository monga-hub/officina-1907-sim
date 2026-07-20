#!/usr/bin/env bash
# Deploy del simulatore su GitHub Pages.
# Ricompila e pubblica dist/index.html sul branch gh-pages del remote "origin".
# Uso: ./deploy.sh   (dopo aver collegato origin — vedi DEPLOY.md)
set -euo pipefail

npm run build

REMOTE=$(git remote get-url origin)
TMP=$(mktemp -d)
cp -R dist/* "$TMP"/
cd "$TMP"
git init -q
git checkout -q -b gh-pages
git add -A
git -c user.email=deploy@local -c user.name=deploy commit -qm "deploy $(date +%F_%T)"
git push -f "$REMOTE" gh-pages
cd - >/dev/null
rm -rf "$TMP"
echo "✓ Pubblicato su gh-pages. URL: https://<utente>.github.io/<repo>/ (attivo dopo ~1 min)"
