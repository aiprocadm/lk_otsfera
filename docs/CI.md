# CI/CD и процессы (фаза 7 «эталонного репозитория»)

## Конвейер (единственный workflow — [.github/workflows/ci.yml](../.github/workflows/ci.yml))

Запуск: каждый PR и push в `main`. Принцип: **CI вызывает те же npm-скрипты,
что и локальные хуки** (CLAUDE.md §6) — серверный и локальный гейты не дрейфуют.

| Job | Что делает | Время |
|---|---|---|
| `checks` | `npm run verify` = typecheck → lint (max-warnings=0) → boundaries (dependency-cruiser) → deadcode (knip) → dup:check (jscpd ≤3%) → format:check (prettier) → test:ci (весь unit-слой, ~8,6 тыс. тестов) | ~10 мин |
| `gate` | `npm run gate` против Postgres service-контейнера: migrate deploy → seed → test:integration (~950 тестов, включая инварианты) + `migrate status` + **drift-check** (`migrate diff --exit-code` schema↔миграции) | ~3 мин |
| `build` | `next build` — прод-сборка собирается (ловит ошибки, которые не видит typecheck: серверные/клиентские границы, конфиг) | ~3–5 мин |
| `audit` | `npm audit --omit=dev --audit-level=critical` — критические уязвимости прод-зависимостей = красная сборка | сек |
| `gitleaks` | скан секретов по всей истории (бинарь + [.gitleaks.toml](../.gitleaks.toml) allowlist) | сек |

Кеш npm — через `actions/setup-node` (`cache: npm`) во всех job'ах.

**Почему audit-level=critical, а не high:** high-уязвимости сейчас — транзитивные
(uuid внутри exceljs, sharp/libvips, brace-expansion, postcss внутри next), фиксов
у упаковщиков нет; их закрывает Renovate по мере релизов (лейбл `security`).
Порог поднять до high, когда список опустеет.

**Redis в CI не нужен:** integration-слой не поднимает BullMQ-очереди (очереди
мокаются; воркер-процессоры тестируются с прямой передачей job-объектов).
Появится тест с живым Redis — добавить service-контейнер в `gate` рядом с Postgres.

## Branch protection — ⚠️ недоступна на текущем тарифе

Проверено 04.08.2026 через API: и классические branch protection rules, и
rulesets отвечают `403 Upgrade to GitHub Pro or make this repository public`.
Репозиторий приватный, владелец — личный аккаунт на бесплатном плане; для
приватных репозиториев защита веток платная.

Варианты:

1. **GitHub Pro** (~$4/мес на аккаунт) — Settings → Billing and plans →
   Upgrade. Тогда применима настройка ниже.
2. **Оставить как есть** — CI гоняется на каждом PR и краснеет при поломке,
   сигнал виден; технически влить красный PR всё ещё можно. При соло-работе
   риск невелик.
3. Сделать репозиторий публичным — защита бесплатна, но код открыт.
   Для коммерческого продукта не подходит.

Настройка, применимая **после** перехода на Pro (мержит только владелец):

- Require a pull request before merging (без прямых push в main), **число
  одобрений — 0**: свой PR одобрить нельзя, с «1» владелец заблокирует сам себя;
- Required status checks: `typecheck · lint · unit`, `integration gate · migrate status`, `build · прод-сборка`, `audit · критические уязвимости`, `gitleaks · скан секретов`;
- Require branches to be up to date before merging — **выключено** (соло-поток, PR мержатся быстро; включить при команде >1);
- Force-push и удаление ветки `main` — запрещены.

## Зависимости — Renovate ([renovate.json](../renovate.json))

- патчи/миноры — групповой PR по понедельникам; мажоры — только через
  Dependency Dashboard (осознанные миграции: prisma 5→7, next и т.п.);
- security-обновления — немедленно, лейбл `security`;
- `xlsx` исключён: стоит тарболом с CDN SheetJS (npm-версия заморожена автором,
  CVE закрыты в 0.20.3) — см. фазу 4;
- включение: установить Renovate GitHub App на репозиторий (действие владельца).

## Процессы PR

- Шаблон PR — [.github/pull_request_template.md](../.github/pull_request_template.md)
  (verify, миграции, флаги, инварианты, откат, секция [BEHAVIOR CHANGE]);
- CODEOWNERS — владелец ревьюит всё;
- Conventional Commits — commitlint в хуке `commit-msg`;
- base всегда `main`, стек через base-ветку запрещён (CLAUDE.md §14);
- каждая фаза/фича = один PR, зелёный CI, обратимый.

## Реестр feature-флагов

Единый реестр — [docs/feature-flags-matrix.md](feature-flags-matrix.md):
семантика, прод-рекомендации, зависимости, владелец и правила выпиливания.
Источник истины по коду — `src/lib/featureFlags.ts`; новый флаг без трёх точек
чтения (§5 CLAUDE.md) и строки в матрице не добавляется.
