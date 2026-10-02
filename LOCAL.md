# GitDiagram local mode

Runs GitDiagram on one machine with no hosted services: diagrams come from your own
[llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server`, are stored on disk, and can be
made from **folders on this machine** as well as from GitHub repositories. No OpenAI, OpenRouter,
Cloudflare R2 or Upstash account is needed.

## Quick start

1. Start a `llama-server` with a capable model (tested: Qwen3.8 27B, `-c 100000`), for example on
   port 8080. It must be a build whose Responses API honors `text.format`, which GitDiagram's graph
   stage needs for structured output (the `video-audio-pipeline` branch of the llama.cpp fork has it;
   see "The model" below).
2. Run the launcher:

   ```bat
   run.bat                 :: Windows
   ```

   ```bash
   ./run.sh                # Linux, macOS, Git Bash
   ```

   The first run installs bun (the version the project pins, 1.3.14), the dependencies and
   `.env.local` (copied from `.env.local.example`). Later runs skip that and start at once.
3. Set `LOCAL_REPO_ROOTS` in `.env.local` (for example `C:\Projects`), restart, and open
   <http://localhost:3000>. The home page lists the folders it found.

| Command | What it does |
|---|---|
| `run.bat` / `./run.sh` | dev server with hot reload |
| `--prod` | production build (first time only), then `next start`: faster pages |
| `--rebuild` | production build again (after changing the code), then `next start` |
| `--port 3100` | another port, any mode |
| `--setup-only` | install what is missing and exit |

Setup is repeated only when `bun.lock` changes (stamp file `node_modules/.bun-lock.stamp`).
The launchers also warn when no `llama-server` answers at `LOCAL_LLM_BASE_URL`; stored
diagrams still open without one. They set `NEXT_TELEMETRY_DISABLED=1`.

## Local folders

`http://localhost:3000/local/<name>` diagrams the folder `<name>` directly inside one of the
`LOCAL_REPO_ROOTS` folders (several: `;` between them on Windows, `:` on Linux). Typing
`local/<name>` into the home page's box works too.

- A git work tree is listed with `git ls-files --cached --others --exclude-standard`, so
  `.gitignore` is honored and untracked files are included. Other folders are walked, skipping
  `.git`, `node_modules`, `venv`, `build`, `dist`, `target`, `out` and the like.
- The same filters as for GitHub apply (images, lock files, minified bundles and so on are left
  out), with at most 100,000 entries.
- Source excerpts are read from disk. Only names one level below a root are accepted; nothing
  outside the roots can be read.
- A local diagram has no links: its components and connections are not clickable, since there is
  no GitHub page to open.

GitHub repositories work as before (`/owner/repo`): public ones without a token, private ones
with a token. `GITHUB_PAT` raises GitHub's rate limit.

## Configuration (`.env.local`)

| Variable | Default | Meaning |
|---|---|---|
| `GITDIAGRAM_LOCAL` | — | `1` turns local mode on: storage on disk, Redis in process |
| `NEXT_PUBLIC_GITDIAGRAM_LOCAL` | — | `1`: the browser side knows `/local/...` has no GitHub page |
| `AI_PROVIDER` | `openai` | `local` uses the `llama-server` below |
| `LOCAL_LLM_BASE_URL` | `http://127.0.0.1:8080/v1` | the server's OpenAI-compatible base URL |
| `LOCAL_LLM_MODEL` | `local` | model name; only matters in `llama-server` router mode |
| `LOCAL_LLM_API_KEY` | — | only if the server was started with `--api-key` |
| `LOCAL_LLM_REASONING_EFFORT` | `app` | `app`: GitDiagram's per-stage effort, mapped to the model's own levels; a level name (e.g. `xhigh`): that level for every request; `default`: none, the template decides |
| `LOCAL_LLM_TIMEOUT_MS` | `600000` | how long one model request may take |
| `LOCAL_REPO_ROOTS` | — | folders whose sub-folders open as `/local/<name>` |
| `LOCAL_DATA_DIR` | `.local-data` | where diagrams and the per-install secret are kept |

## The model

GitDiagram talks to the server through the OpenAI **Responses API** (`/v1/responses`):

- **Structured output.** The graph stage sends a strict JSON schema in `text.format`. `llama-server`
  must turn that into a grammar (`response_format`); without it the model's JSON is not
  constrained and graphs fail validation. The fork's `tools/server/server-chat.cpp` does this.
- **Reasoning effort.** GitDiagram asks for `low` or `medium` per stage. A chat template accepts
  only its own levels and raises on others, so the level sent is the nearest one the model
  reports in `/props` (`reasoning_efforts`; Qwen3.8: low / medium / xhigh). See
  `LOCAL_LLM_REASONING_EFFORT` to pin one.
- **No output cap.** GitDiagram never sends `max_output_tokens`, so reasoning and output finish
  in full. The prompt is bounded (file tree, README, up to 48k characters of source); the
  llama.cpp repository took about 29k input tokens, so a context of 64k or more is comfortable.
- **Cost** shows as $0.

Measured on an RTX 5090 with Qwen3.8 27B NVFP4: a small folder takes about 45 s, the llama.cpp
repository about 90 s, and both graphs validated on the first attempt.

## What runs where

| Hosted (upstream) | Local mode |
|---|---|
| OpenAI / OpenRouter | your `llama-server` (`src/server/generate/local-llm.ts`) |
| Cloudflare R2 | files under `.local-data/objects/<bucket>/` (`src/server/storage/local-object-store.ts`) |
| Upstash Redis | in-process Redis with Lua scripting, `ioredis-mock` (`src/server/storage/local-redis.ts`) |
| `CACHE_KEY_SECRET` | a random secret made once, `.local-data/cache-key-secret` |

Redis holds only short-lived state (rate limits, locks, cancellation flags, caches), so losing it
on restart does no harm. Diagrams persist in `.local-data`; delete that folder to start over.

Explainer videos, the operator dashboard (`/admin`), paid videos, live presence and AI-visibility
checks stay off: they need their own keys and flags, none of which are set. Network calls that
remain: the GitHub API (for GitHub repositories, and the header's star count) and the sponsor
banner's images.

## Tests

```bash
bun run test src/server/storage/local-mode.test.ts src/server/generate/local-llm.test.ts \
             src/server/generate/local-repo.test.ts
bun run test                                   # everything
node node_modules/typescript-7/bin/tsc --noEmit  # typecheck (bun cannot run the bin on Windows)
```

On Windows nine upstream test files fail regardless of local mode: the `*.redis.test.ts` files
need a `redis-server` binary, two video-storage tests hit Windows file locking, and two sponsor
tests depend on the date.
