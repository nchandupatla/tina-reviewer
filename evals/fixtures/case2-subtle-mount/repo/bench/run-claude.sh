#!/usr/bin/env bash
# Runs Claude Code once on the same challenge, in the same sandbox image, and keeps the receipts.
# It uses the same OpenRouter key and the same model as TINA, so both are billed by one provider.
# Usage: bench/run-claude.sh [preset]    (preset from models.json, default: haiku)
# Never edit this file while a run is going: bash reads scripts as it executes them.
set -euo pipefail
cd "$(dirname "$0")/.."

preset="${1:-haiku}"
model="$(node -p "require('./models.json')['$preset']?.id ?? ''")"
[ -n "$model" ] || { echo "✗ unknown preset '$preset'"; exit 1; }
# Exported (not passed as an argument) so the key never shows up in `ps`.
export ANTHROPIC_AUTH_TOKEN="$(grep '^TINA_API_KEY=' .env | cut -d= -f2-)"

docker image inspect tina-sandbox >/dev/null 2>&1 || docker build -q -t tina-sandbox sandbox/
docker image inspect tina-claude >/dev/null 2>&1 || docker build -q -t tina-claude -f bench/claude.Dockerfile bench/

out="bench/runs/$(date +%Y%m%d-%H%M%S)-claude-$preset"
mkdir -p "$out/workspace"
cp -R bench/template/. "$out/workspace/" && rm -f "$out/workspace/.gitkeep"

echo "✳ Claude Code · $model → $out"
before="$(bench/spend.sh)"
start=$(date +%s)
# Claude Code needs network to reach the API, and its key lives inside this container (disclosed in the video).
# The 20-minute limit runs INSIDE the container (coreutils timeout), and the container is force-removed
# on exit, so a stuck run can never outlive the limit.
name="tina-claude-run-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
docker run --rm --name "$name" --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
    --memory 1g --pids-limit 256 --user "$(id -u):$(id -g)" \
    -e ANTHROPIC_BASE_URL=https://openrouter.ai/api -e ANTHROPIC_AUTH_TOKEN -e ANTHROPIC_API_KEY= \
    -e ANTHROPIC_DEFAULT_HAIKU_MODEL="$model" -e ANTHROPIC_SMALL_FAST_MODEL="$model" \
    -e DISABLE_TELEMETRY=1 -e DISABLE_ERROR_REPORTING=1 \
    -v "$PWD/$out/workspace:/workspace" -w /workspace tina-claude \
    timeout -k 10 1200 claude -p "$(cat bench/PROMPT.md)" --model "$model" --output-format stream-json --verbose --dangerously-skip-permissions \
  > "$out/transcript.jsonl" 2> "$out/stderr.txt" || true
sleep 5 # OpenRouter's spend counter lags a few seconds
after="$(bench/spend.sh)"

node -e '
const fs = require("fs"); const [file, out, model, start, before, after] = process.argv.slice(1);
// stream-json writes one event per line; the last "result" event has the outcome.
const events = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
const r = events.findLast((e) => e.type === "result") ?? {};
const seconds = Math.round(Date.now() / 1000 - start);
const summary = {
  agent: "claude-code", model, finished: r.subtype === "success" && !r.is_error && seconds <= 1215, steps: r.num_turns ?? null,
  seconds, billed: +(after - before).toFixed(6), result: r.result ?? null,
};
fs.writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
' "$out/transcript.jsonl" "$out/summary.json" "$model" "$start" "$before" "$after"
