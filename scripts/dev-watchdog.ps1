# dev-watchdog.ps1 — keeps the local dev server alive independent of any agent turn.
# Run by the Scheduled Task "lk-dev-server" every minute. Idempotent: only acts when
# port 3000 is dead. Spawned `next dev` is detached and survives this script exiting.
$ErrorActionPreference = 'SilentlyContinue'
# Репозиторий — родитель папки scripts/, а не жёстко прошитый путь (переносимость).
$repo = Split-Path -Parent $PSScriptRoot

# Порты должны совпадать с dev-stack.ps1: Redis по умолчанию 6500 (6379 в
# зарезервированном Windows-диапазоне). Иначе проверка вечно ложна и dev-stack
# перезапускается каждую минуту, насыщая пул соединений PostgreSQL.
$PgPort    = if ($env:PG_PORT)    { [int]$env:PG_PORT }    else { 5432 }
$RedisPort = if ($env:REDIS_PORT) { [int]$env:REDIS_PORT } else { 6500 }

function Test-Port($p) { [bool](Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) }

# Ensure infra (PG + Redis + migrations) without starting next dev — fast & idempotent.
if (-not (Test-Port $PgPort) -or -not (Test-Port $RedisPort)) {
  try { & (Join-Path $repo 'scripts\dev-stack.ps1') -NoDev *> (Join-Path $repo 'watchdog-infra.log') } catch {}
}

# Bring up the web server only if it is not already listening.
if (-not (Test-Port 3000)) {
  Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory $repo -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $repo 'dev-server.log') `
    -RedirectStandardError  (Join-Path $repo 'dev-server.err.log')
}
