#!/usr/bin/env bash
# Runs TINA once on the challenge in a fresh folder and keeps everything as receipts.
# Usage: bench/run-tina.sh [preset]      (preset from models.json, default: haiku)
set -euo pipefail
cd "$(dirname "$0")/.."

preset="${1:-haiku}"
out="bench/runs/$(date +%Y%m%d-%H%M%S)-tina-$preset"
mkdir -p "$out/workspace"
cp -R bench/template/. "$out/workspace/" && rm -f "$out/workspace/.gitkeep"

echo "☁ TINA · $preset → $out"
before="$(bench/spend.sh)"
# Same rules as Claude Code: 20-minute wall clock, and network on (Claude Code needs it to reach the API).
# perl's alarm works on macOS and Linux.
TINA_NET=1 perl -e 'alarm shift; exec @ARGV' 1200 \
  node ui.js --model "$preset" --dir "$PWD/$out/workspace" --summary "$out/summary.json" "$(cat bench/PROMPT.md)" \
  | tee "$out/terminal.txt" || true
sleep 5 # OpenRouter's spend counter lags a few seconds
after="$(bench/spend.sh)"

[ -f "$out/summary.json" ] || echo '{"finished": false}' > "$out/summary.json"
node -e '
const fs = require("fs"); const [file, before, after] = process.argv.slice(1);
const summary = { agent: "tina", ...JSON.parse(fs.readFileSync(file, "utf8")), billed: +(after - before).toFixed(6) };
if (summary.transcript) fs.copyFileSync(summary.transcript.replace("~", process.env.HOME), file.replace("summary.json", "transcript.jsonl"));
fs.writeFileSync(file, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
' "$out/summary.json" "$before" "$after"
