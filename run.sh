#!/usr/bin/env bash
# GitDiagram local launcher (Linux, macOS, Git Bash)
# Local mode: diagrams from your own llama-server, stored on disk, no hosted
# services (see LOCAL.md). First run: installs bun (the version the project
# pins), the dependencies and .env.local. Later runs skip that (stamp file).
#   ./run.sh                -> dev server with hot reload, http://localhost:3000
#   ./run.sh --prod         -> production build (once), then next start
#   ./run.sh --rebuild      -> production build again, then next start
#   ./run.sh --port 3100    -> another port (any mode)
#   ./run.sh --setup-only   -> do the setup steps and exit (no launch)
set -euo pipefail
cd "$(dirname "$0")"

BUN_VERSION=1.3.14
PORT=3000
MODE=dev
REBUILD=0
while [ $# -gt 0 ]; do
    case "$1" in
        --prod) MODE=prod ;;
        --rebuild) MODE=prod; REBUILD=1 ;;
        --setup-only) MODE=setup ;;
        --port) PORT="$2"; shift ;;
        *) echo "[ERROR] unknown option: $1"; exit 2 ;;
    esac
    shift
done

# bun: the project's package manager and runtime
if ! command -v bun >/dev/null && [ -x "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
fi
if ! command -v bun >/dev/null; then
    echo "[Setup] Installing bun $BUN_VERSION..."
    case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*) npm install -g "bun@$BUN_VERSION" ;;
        *) curl -fsSL https://bun.sh/install | bash -s "bun-v$BUN_VERSION"
           export PATH="$HOME/.bun/bin:$PATH" ;;
    esac
fi

# Dependencies: install only on first run or when bun.lock changes.
# --ignore-scripts: the root "prepare" hook only sets up upstream's git hooks,
# and the one trusted install script (ffmpeg-static) is for the video feature,
# which local mode does not use.
if ! cmp -s bun.lock node_modules/.bun-lock.stamp 2>/dev/null; then
    echo "[Setup] Installing dependencies (first run / bun.lock changed)..."
    bun install --frozen-lockfile --ignore-scripts
    cp bun.lock node_modules/.bun-lock.stamp
fi

# Settings: .env.local from the example on first run
if [ ! -f .env.local ]; then
    cp .env.local.example .env.local
    echo "[Setup] Created .env.local - set LOCAL_REPO_ROOTS and LOCAL_LLM_BASE_URL there."
fi

if [ "$MODE" = setup ]; then
    echo "[OK] Setup complete - bun, dependencies and .env.local ready."
    exit 0
fi

# Is the model up? (a warning only: stored diagrams open without it)
LLM_URL="$(sed -n 's/^LOCAL_LLM_BASE_URL=//p' .env.local | tail -n 1 | tr -d '\r')"
LLM_ORIGIN="${LLM_URL:-http://127.0.0.1:8080/v1}"
LLM_ORIGIN="${LLM_ORIGIN%/}"
LLM_ORIGIN="${LLM_ORIGIN%/v1}"
if curl -s -f -m 3 -o /dev/null "$LLM_ORIGIN/health"; then
    echo "[OK] llama-server answering at $LLM_ORIGIN"
else
    echo "[WARN] No llama-server answering at $LLM_ORIGIN - start one before generating new diagrams."
fi

export NEXT_TELEMETRY_DISABLED=1
# the MCP App view served under /mcp (quick esbuild bundle)
bun scripts/build-mcp-app.mjs

if [ "$MODE" = dev ]; then
    echo "[Start] http://localhost:$PORT (dev server, hot reload)"
    exec bun run --bun next dev --turbo --port "$PORT"
fi

if [ "$REBUILD" = 1 ] || [ ! -f .next/BUILD_ID ]; then
    echo "[Build] Production build (a few minutes)..."
    bun run --bun next build
fi
echo "[Start] http://localhost:$PORT (production build; ./run.sh --rebuild after code changes)"
exec bun run --bun next start --port "$PORT"
