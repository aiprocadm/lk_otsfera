# Bootstrap Admin — Close-out (DONE)

**Дата:** 2026-06-20
**Ветка:** `claude/bootstrap-admin` (от `main` @ `54b67ae`)
**Spec:** [2026-06-20-bootstrap-admin-design.md](../specs/2026-06-20-bootstrap-admin-design.md) · **Plan:** [2026-06-20-bootstrap-admin.md](2026-06-20-bootstrap-admin.md)

## Что отгружено

Разовый идемпотентный CLI для создания первого реального `admin` в не-демо БД — закрывает «замкнутый цикл» (через приложение admin завести нельзя; 1С юзеров не создаёт; admin чеканил только демо-`seed.ts`).

| Что | Файл | Коммит |
|---|---|---|
| Ядро `bootstrapAdmin` (Result-контракт §3) + integration-тест (6 сценариев) | [scripts/create-admin.ts](../../../scripts/create-admin.ts), [src/__tests__/scripts.bootstrap-admin.test.ts](../../../src/__tests__/scripts.bootstrap-admin.test.ts) | `56369ee` (+ refactor `52ce094`) |
| Runner (env-вход, guard от запуска при импорте, exit-коды) | scripts/create-admin.ts | `2cfd711` |
| npm-алиас `db:create-admin` + блок `ADMIN_*` в `.env.example` | [package.json](../../../package.json), [.env.example](../../../.env.example) | `4f85d66` |

## Поведение

```bash
ADMIN_EMAIL=admin@example.ru ADMIN_PASSWORD=secret12 npm run db:create-admin
# опц.: ADMIN_NAME (деф. «Администратор»), ADMIN_COMPANY (деф. «Промтехносфера»)
```

- **Вход только через env** (не CLI-аргументы) — пароль не попадает в историю shell / `ps`.
- Идемпотентно: нет → создаём `admin`; есть `admin` → no-op (пароль **не** перезаписываем); есть не-admin → отказ (privilege-escalation guard).
- Компания — find-or-create по имени (`Company.name` не unique).
- Транзакция: company + user + audit (`admin_bootstrapped`) атомарно; пароль (bcrypt cost 10) нигде не логируется и не в audit-payload.
- Коды выхода: `0` — создан/уже был admin; `1` — ошибка валидации / email занят не-admin / сбой БД.

## Верификация

- typecheck ✓, lint ✓ (только предсуществующий warning в coverage-артефакте), integration `scripts.bootstrap-admin` **6/6** на живом PG ✓.
- Ручной прогон runner'а: happy / идемпотент / weak-password / no-env — все 4 с верными exit-кодами; тестовый админ подчищен.
- Двухстадийное ревью на каждую задачу (spec + code-quality) + финальное holistic — «ready to merge», ни critical, ни important.

## Сознательно НЕ сделано (YAGNI / вне scope)

- Runner/guard не покрыт автотестом (process.exit/console; как и прочие `scripts/*` runner'ы). Покрыто ядро.
- Email не нормализуется к lower-case — **намеренно**, консистентно со всем кодом (login/`createUser`/seed тоже case-sensitive). Нормализация email — отдельная общесистемная тема, вне этой фичи.

## Где встраивается в запуск «не демо»

Это недостающий кирпич для **чистого боевого старта** (см. [runbook-launch-deploy.md](../../runbook-launch-deploy.md), который молча предполагал наличие админа): пустая БД → `db:create-admin` → вход → дальше всё через кабинет администратора (инвайты). Для скрытия демо-логинов на `/login` отдельно: `SHOW_DEMO_LOGINS` (по умолчанию OFF).
