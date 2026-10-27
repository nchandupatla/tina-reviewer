#!/usr/bin/env bash
# Prints total USD spent so far on the OpenRouter key in .env.
# Both agents are billed through the same key, so before/after spend is the fairest cost measure.
set -euo pipefail
cd "$(dirname "$0")/.."
key="$(grep '^TINA_API_KEY=' .env | cut -d= -f2-)"
curl -s https://openrouter.ai/api/v1/key -H "Authorization: Bearer $key" | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s).data.usage));'
