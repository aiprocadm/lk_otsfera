<!-- Заголовок: type(scope): описание — Conventional Commits (commitlint). -->

## Что сделано

<!-- Коротко: что и зачем. Ссылки на спеку/план из docs/superpowers, если есть. -->

## Чек-лист

- [ ] `npm run verify` зелёный локально (typecheck · lint · boundaries · deadcode · dup · format · unit)
- [ ] Миграции: новых нет / есть и применяются с нуля (`prisma migrate deploy` на чистой БД); применённые миграции не редактировались
- [ ] Feature-флаги: новые точки чтения соответствуют §5 CLAUDE.md; матрица [docs/feature-flags-matrix.md](../docs/feature-flags-matrix.md) обновлена
- [ ] Инварианты [docs/INVARIANTS.md](../docs/INVARIANTS.md) не развёрнуты; новые правила продукта закреплены инвариант-тестом
- [ ] `Company` ≠ `Organization` не смешаны; RBAC defense-in-depth (§4) не сокращён
- [ ] Понятен откат (revert PR достаточно / нужны шаги — какие?)

## [BEHAVIOR CHANGE]

<!-- «Отсутствует» — или что именно меняется для пользователей и почему это согласовано. -->

## Как откатить

<!-- revert PR / особые шаги (миграции, флаги). -->
