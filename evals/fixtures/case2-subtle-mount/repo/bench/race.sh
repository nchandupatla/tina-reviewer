#!/usr/bin/env bash
# One word switches both agents to the same brain: bench/race.sh haiku
set -euo pipefail
cd "$(dirname "$0")"
preset="${1:-haiku}"
./run-tina.sh "$preset"
./run-claude.sh "$preset"
