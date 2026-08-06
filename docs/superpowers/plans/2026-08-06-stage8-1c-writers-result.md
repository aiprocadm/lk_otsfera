# Этап 8 «Writer'ы возвращают результат + модели батча» — план

**Спека:** [2026-08-06-stage8-1c-writers-result-design.md](../specs/2026-08-06-stage8-1c-writers-result-design.md) — подтверждена заказчиком («ок», 06.08.2026, PR #324)
**ТЗ:** Т-32…Т-34 · риск средний · строго до этапа 9

REQUIRED SUB-SKILL: superpowers:subagent-driven-development (выполнено одним агентом последовательно — объём связный, файлы пересекаются)

## Задачи

- [x] `prisma/schema.prisma`: `OneCImportBatch` + `OneCImportRow` по эскизу ТЗ + связь `User.oneCImportBatches`; аддитивная миграция; `prisma:generate` (Т-32)
- [x] `oneCSync/writers.ts`: тип `WriteOutcome`; три writer'а возвращают `WriteOutcome | undefined` (undefined = skip/shadow); расширенные `select` под снимки `before` (Т-34, список §4.2 спеки)
- [x] `import/index.ts`: сбор строк в `run()` (замыкание), запись батча+строк в `commitImport` — non-blocking (§4.4), `fileKey: null`, `fileName ?? '—'` (Т-33)
- [x] Тесты: unit writers (created/updated+before/undefined), unit import/index (батч пишется, preview нет, отказ non-blocking), integration этапа 8 (created + повтор → updated с before, каскад удаления)
- [x] Гейты: typecheck, lint, prettier, покрытие изменённых 100%, полный integration на СВЕЖЕЙ seed-базе, полный unit
- [x] CHANGELOG, close-out, STATUS.md
