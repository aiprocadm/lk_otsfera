# dev-stack.ps1 — надёжный запуск локального стека без виртуализации.
#
# Поднимает нативные PostgreSQL + Redis как обычные Windows-процессы и стартует
# `next dev`. Самовосстанавливающийся и идемпотентный: чинит типовые причины
# «не запустилось» — нет кластера, нет БД, непринятые миграции, сервис не успел
# подняться. Повторный запуск при уже поднятом стеке не выдаёт ошибок.
#
# Использование:
#   pwsh -File scripts/dev-stack.ps1            # поднять стек и запустить dev-сервер
#   pwsh -File scripts/dev-stack.ps1 -NoDev     # только инфраструктура (PG+Redis+миграции), без next dev
#   pwsh -File scripts/dev-stack.ps1 -Reset     # ПЕРЕСОЗДАТЬ БД cabinet (DESTRUCTIVE) + миграции, затем dev
#
# Пути портативных сборок (по умолчанию в профиле пользователя) — через env:
#   $env:PG_HOME  $env:PG_DATA  $env:REDIS_HOME
# Порты (дефолты PG 5432 / Redis 6500) — через env:
#   $env:PG_PORT  $env:REDIS_PORT

[CmdletBinding()]
param(
  [switch]$NoDev,
  [switch]$Reset
)

$ErrorActionPreference = 'Stop'

$PgHome    = if ($env:PG_HOME)    { $env:PG_HOME }    else { Join-Path $env:USERPROFILE 'pgdb\pgsql' }
$PgData    = if ($env:PG_DATA)    { $env:PG_DATA }    else { Join-Path $env:USERPROFILE 'pgdb\data' }
$PgLog     = Join-Path (Split-Path $PgData -Parent) 'pg.log'
$RedisHome = if ($env:REDIS_HOME) { $env:REDIS_HOME } else { Join-Path $env:USERPROFILE 'redis' }
$RepoRoot  = Split-Path -Parent $PSScriptRoot

$PgCtl   = Join-Path $PgHome 'bin\pg_ctl.exe'
$Psql    = Join-Path $PgHome 'bin\psql.exe'
$InitDb  = Join-Path $PgHome 'bin\initdb.exe'
$RedisExe= Join-Path $RedisHome 'redis-server.exe'
$RedisCli= Join-Path $RedisHome 'redis-cli.exe'

$DbName  = 'cabinet'
$PgPort  = if ($env:PG_PORT)    { [int]$env:PG_PORT }    else { 5432 }
# 6379 попадает в зарезервированный Windows-диапазон (Hyper-V/WSL) и Redis там не
# биндится → дефолт 6500. Переопределяется через $env:REDIS_PORT. Должен совпадать
# с REDIS_URL в .env и с проверкой порта в dev-watchdog.ps1.
$RedisPort = if ($env:REDIS_PORT) { [int]$env:REDIS_PORT } else { 6500 }

function Info($m)  { Write-Host "[stack] $m" -ForegroundColor Cyan }
function Ok($m)    { Write-Host "[ ok  ] $m" -ForegroundColor Green }
function Skip($m)  { Write-Host "[skip ] $m" -ForegroundColor DarkGray }
function Die($m)   { Write-Host "[fail ] $m" -ForegroundColor Red; exit 1 }

function Test-Port($port) {
  [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

# psql против maintenance-БД `postgres`; возвращает $true при успехе.
function Test-PgReady {
  try {
    $env:PGPASSWORD = 'postgres'
    & $Psql -h 127.0.0.1 -p $PgPort -U postgres -d postgres -tAc 'select 1' *> $null
    return ($LASTEXITCODE -eq 0)
  } catch { return $false }
}

function Invoke-Psql([string]$db, [string]$sql) {
  $env:PGPASSWORD = 'postgres'
  return (& $Psql -h 127.0.0.1 -p $PgPort -U postgres -d $db -tAc $sql)
}

# ---------------------------------------------------------------------------
# 0. Preflight — бинарники на месте?
# ---------------------------------------------------------------------------
if (-not (Test-Path $PgCtl))    { Die "PostgreSQL не установлен: нет $PgCtl. Сначала разверни портативный PG (см. project-running-locally в памяти) или задай `$env:PG_HOME." }
if (-not (Test-Path $RedisExe)) { Die "Redis не установлен: нет $RedisExe. Разверни портативный Redis или задай `$env:REDIS_HOME." }

# ---------------------------------------------------------------------------
# 1. PostgreSQL — кластер, запуск, готовность
# ---------------------------------------------------------------------------
if (-not (Test-Path (Join-Path $PgData 'PG_VERSION'))) {
  Info "кластер не инициализирован — initdb в $PgData"
  & $InitDb -D $PgData -U postgres -A trust -E UTF8 --locale=C | Out-Null
  if ($LASTEXITCODE -ne 0) { Die 'initdb завершился с ошибкой' }
  Ok 'кластер создан'
}

if (Test-Port $PgPort) {
  Skip "PostgreSQL: порт $PgPort уже занят"
} else {
  Info "стартую PostgreSQL на :$PgPort"
  & $PgCtl -D $PgData -l $PgLog -o "-p $PgPort" -w start | Out-Null
}

# ждём реальной готовности принимать соединения (не только LISTEN на порту)
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  if (Test-PgReady) { $ready = $true; break }
  Start-Sleep -Milliseconds 700
}
if (-not $ready) { Die "PostgreSQL не отвечает на :$PgPort (см. $PgLog)" }
Ok "PostgreSQL принимает соединения на :$PgPort"

# ---------------------------------------------------------------------------
# 2. БД cabinet — создать с ICU-локалью если нет (или пересоздать при -Reset)
# ---------------------------------------------------------------------------
if ($Reset) {
  Info "-Reset: пересоздаю БД '$DbName' (DESTRUCTIVE)"
  Push-Location $RepoRoot
  npm run db:recreate-local
  if ($LASTEXITCODE -ne 0) { Pop-Location; Die 'db:recreate-local завершился с ошибкой' }
  Pop-Location
} else {
  $exists = (Invoke-Psql 'postgres' "SELECT 1 FROM pg_database WHERE datname='$DbName'").Trim()
  if ($exists -ne '1') {
    Info "БД '$DbName' отсутствует — создаю с ICU-локалью"
    # Зеркалит scripts/recreate-local-db.ts: ICU нужен для кириллического ILIKE
    Invoke-Psql 'postgres' "CREATE DATABASE ""$DbName"" TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' LC_COLLATE 'C' LC_CTYPE 'C'" | Out-Null
    if ($LASTEXITCODE -ne 0) { Die "не удалось создать БД '$DbName'" }
    Ok "БД '$DbName' создана"
  } else {
    Skip "БД '$DbName' уже существует"
  }
}

# проверка кириллического case-folding — если сломано, лучше упасть здесь явно
$fold = (Invoke-Psql $DbName "SELECT ('Иван' ILIKE 'иван')").Trim()
if ($fold -ne 't') { Die "БД '$DbName' не складывает регистр кириллицы (locale не ICU). Перезапусти с -Reset." }

# ---------------------------------------------------------------------------
# 3. Prisma — клиент + миграции (идемпотентно)
# ---------------------------------------------------------------------------
Push-Location $RepoRoot
if (-not (Test-Path (Join-Path $RepoRoot 'node_modules\.prisma\client\index.js'))) {
  Info 'генерирую Prisma Client'
  npx prisma generate | Out-Null
}
Info 'применяю миграции (prisma migrate deploy)'
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { Pop-Location; Die 'prisma migrate deploy завершился с ошибкой' }
Ok 'схема БД актуальна'
Pop-Location

# ---------------------------------------------------------------------------
# 4. Redis — конфиг, запуск, PONG
# ---------------------------------------------------------------------------
$RedisConf = Join-Path $RedisHome 'redis.conf'
# Конфиг-файл, а не CLI: Start-Process отбрасывает пустой `--save ""`,
# из-за чего Redis падает с "Not enough parameters available for --save".
# Перегенерируем, если конфига нет ИЛИ он закрепляет другой порт (иначе stale
# `port 6379` переживёт смену $RedisPort и Redis снова не поднимется).
if (-not (Test-Path $RedisConf) -or -not ((Get-Content $RedisConf -ErrorAction SilentlyContinue) -contains "port $RedisPort")) {
  Set-Content -Path $RedisConf -Value @("port $RedisPort", 'save ""', 'appendonly no') -Encoding ascii
}
if (Test-Port $RedisPort) {
  Skip "Redis: порт $RedisPort уже занят"
} else {
  Info "стартую Redis на :$RedisPort"
  Start-Process -FilePath $RedisExe -ArgumentList "`"$RedisConf`"" `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $RedisHome 'redis.log') `
    -RedirectStandardError  (Join-Path $RedisHome 'redis.err.log')
}
$pong = $false
for ($i = 0; $i -lt 15; $i++) {
  try { if ((& $RedisCli -p $RedisPort ping 2>$null) -match 'PONG') { $pong = $true; break } } catch {}
  Start-Sleep -Milliseconds 500
}
if (-not $pong) { Die "Redis не ответил PONG на :$RedisPort (см. $RedisHome\redis.err.log)" }
Ok "Redis отвечает PONG на :$RedisPort"

# ---------------------------------------------------------------------------
# 5. Итог + dev-сервер
# ---------------------------------------------------------------------------
Write-Host ''
Ok "локальный стек готов: PostgreSQL :$PgPort + Redis :$RedisPort + БД cabinet (миграции применены)"

if ($NoDev) {
  Info '-NoDev: пропускаю запуск next dev'
  exit 0
}

if (Test-Port 3000) {
  Skip 'next dev: порт 3000 уже занят — пропускаю (сервер, вероятно, уже запущен)'
  exit 0
}
Info 'запускаю next dev на :3000 (первая компиляция роутов может занять до ~2 мин)'
Set-Location $RepoRoot
npm run dev
