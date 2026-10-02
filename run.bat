@echo off
setlocal
cd /d "%~dp0"

rem ===== GitDiagram local launcher (Windows) ==============================
rem Local mode: diagrams from your own llama-server, stored on disk, no
rem hosted services (see LOCAL.md). First run: installs bun (the version the
rem project pins), the dependencies and .env.local. Later runs skip that
rem (stamp file) and start the server immediately.
rem   run.bat                ...dev server with hot reload, http://localhost:3000
rem   run.bat --prod         ...production build (once), then next start
rem   run.bat --rebuild      ...production build again, then next start
rem   run.bat --port 3100    ...another port (any mode)
rem   run.bat --setup-only   ...do the setup steps and exit (no launch)

set "BUN_VERSION=1.3.14"
set "PORT=3000"
set "MODE=dev"
set "REBUILD=0"

:args
if "%~1"=="" goto :args_done
set "KNOWN=0"
if /i "%~1"=="--prod" (
    set "MODE=prod"
    set "KNOWN=1"
)
if /i "%~1"=="--rebuild" (
    set "MODE=prod"
    set "REBUILD=1"
    set "KNOWN=1"
)
if /i "%~1"=="--setup-only" (
    set "MODE=setup"
    set "KNOWN=1"
)
if /i "%~1"=="--port" (
    set "PORT=%~2"
    set "KNOWN=1"
    shift
)
if "%KNOWN%"=="0" (
    echo [ERROR] unknown option: %~1
    exit /b 2
)
shift
goto :args
:args_done

rem ===== bun: the project's package manager and runtime
where bun >nul 2>nul
if not errorlevel 1 goto :bun_ok
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Neither bun nor npm found. Install Node.js 22+ or bun: https://bun.sh
    exit /b 1
)
echo [Setup] Installing bun %BUN_VERSION% with npm...
call npm install -g bun@%BUN_VERSION% || exit /b 1
:bun_ok

rem ===== Dependencies: install only on first run or when bun.lock changes.
rem --ignore-scripts: the root "prepare" hook (git hooks for upstream's CI)
rem does not run on Windows, and the one trusted install script (ffmpeg-static)
rem is only for the video feature, which local mode does not use.
fc /b bun.lock "node_modules\.bun-lock.stamp" >nul 2>nul
if not errorlevel 1 goto :deps_ok
echo [Setup] Installing dependencies (first run / bun.lock changed)...
call bun install --frozen-lockfile --ignore-scripts || exit /b 1
copy /y bun.lock "node_modules\.bun-lock.stamp" >nul
:deps_ok

rem ===== Settings: .env.local from the example on first run
if not exist ".env.local" (
    copy /y .env.local.example .env.local >nul
    echo [Setup] Created .env.local - set LOCAL_REPO_ROOTS and LOCAL_LLM_BASE_URL there.
)

if /i "%MODE%"=="setup" (
    echo [OK] Setup complete - bun, dependencies and .env.local ready.
    exit /b 0
)

rem ===== Is the model up? (a warning only: stored diagrams open without it)
set "LLM_URL=http://127.0.0.1:8080/v1"
for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env.local") do (
    if /i "%%a"=="LOCAL_LLM_BASE_URL" set "LLM_URL=%%b"
)
set "LLM_ORIGIN=%LLM_URL:/v1=%"
curl -s -f -m 3 -o nul "%LLM_ORIGIN%/health" >nul 2>nul
if errorlevel 1 (
    echo [WARN] No llama-server answering at %LLM_ORIGIN% - start one before generating new diagrams.
) else (
    echo [OK] llama-server answering at %LLM_ORIGIN%
)

set "NEXT_TELEMETRY_DISABLED=1"
rem the MCP App view served under /mcp (quick esbuild bundle)
call bun scripts/build-mcp-app.mjs || exit /b 1

if /i "%MODE%"=="dev" (
    echo [Start] http://localhost:%PORT% ^(dev server, hot reload^)
    call bun run --bun next dev --turbo --port %PORT%
    exit /b %errorlevel%
)

if "%REBUILD%"=="1" goto :build
if exist ".next\BUILD_ID" goto :start
:build
echo [Build] Production build (a few minutes)...
call bun run --bun next build || exit /b 1
:start
echo [Start] http://localhost:%PORT% ^(production build; run.bat --rebuild after code changes^)
call bun run --bun next start --port %PORT%
exit /b %errorlevel%
