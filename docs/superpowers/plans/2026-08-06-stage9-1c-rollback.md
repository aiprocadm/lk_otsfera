# Этап 9 «Откат импорта с защитой от конфликтов» — план

**Спека:** [2026-08-06-stage9-1c-rollback-design.md](../specs/2026-08-06-stage9-1c-rollback-design.md) — подтверждена заказчиком («ок», 06.08.2026, PR #325)
**ТЗ:** Т-35…Т-40 · риск **высокий** · после этапа 8

REQUIRED SUB-SKILL: superpowers:subagent-driven-development (выполнено одним агентом последовательно — объём связный, файлы пересекаются)

## Задачи

- [x] `lib/services/import/rollback.ts`: `listImportBatches` (20, скоуп руководителя), `planImportRollback` (счётчики+конфликты), `rollbackImport` (одна транзакция, пересчёт конфликтов внутри, обратный порядок, restore из `before`, статусы, аудит в транзакции) — Т-35…Т-38, Т-40
- [x] Конфликты §4.2: список ТЗ + любая посторонняя связь; распространение вверх; `updated`-строка с удалённой записью = конфликт
- [x] `lib/auth/audit.ts` + `lib/audit/labels.ts`: действие `one_c_import.rollback` + русское название
- [x] `server-actions/import.ts`: + `planImportRollbackAction`, `rollbackImportAction` (+revalidate)
- [x] `components/import/import-history.tsx`: таблица 20 батчей + диалог подтверждения + диалог конфликтов (примитив `Dialog`, дефолт «Отменить»), toast
- [x] Страницы excel (admin + leader): блок «История импортов»
- [x] Тесты: unit rollback (права/сроки/статусы/распространение), unit import-history (jsdom), integration этапа 9 (чистый откат, конфликтный full/partial, повторный partial, 30 дней)
- [x] Гейты: typecheck, lint, prettier, покрытие изменённых 100%, полный integration на свежей seed-базе, полный unit
- [x] CHANGELOG, close-out, STATUS.md
