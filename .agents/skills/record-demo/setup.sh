#!/usr/bin/env bash
# Installs what record.mjs needs, outside the repository: Playwright in $DEMO_TOOLS
# (default /tmp/demo-tools), a Chromium (Playwright's, or Google Chrome when its CDN is
# unreachable) and ffmpeg. Safe to run again.
set -euo pipefail
tools=${DEMO_TOOLS:-/tmp/demo-tools}
mkdir -p "$tools"
[ -d "$tools/node_modules/playwright" ] || npm install --prefix "$tools" --no-save --silent playwright
sudo=$(command -v sudo || true)
command -v ffmpeg >/dev/null || { $sudo apt-get update -qq && $sudo apt-get install -y -qq ffmpeg; }
if ! (cd "$tools" && npx playwright install --with-deps chromium) >"$tools/install.log" 2>&1; then
  if ! command -v google-chrome >/dev/null; then
    curl -sSLo "$tools/chrome.deb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
    $sudo apt-get install -y -qq "$tools/chrome.deb"
  fi
  echo "Playwright's Chromium is unavailable; using $(command -v google-chrome)"
fi
# Playwright records video with its own ffmpeg build; point it at the system one if it is missing.
rev=$(node -e "const b=require('$tools/node_modules/playwright-core/browsers.json').browsers.find(b=>b.name==='ffmpeg');console.log(b.revision)")
ff="$HOME/.cache/ms-playwright/ffmpeg-$rev/ffmpeg-linux"
[ -x "$ff" ] || { mkdir -p "$(dirname "$ff")"; ln -sf "$(command -v ffmpeg)" "$ff"; }
echo "ready: $tools"
