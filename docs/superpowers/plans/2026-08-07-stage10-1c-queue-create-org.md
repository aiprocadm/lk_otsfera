# Этап 10 «Создание организации из очереди выписки» — план

**Спека:** [2026-08-07-stage10-1c-queue-create-org-design.md](../specs/2026-08-07-stage10-1c-queue-create-org-design.md) — подтверждена заказчиком («ок», 07.08.2026, PR #327)
**ТЗ:** Т-30, Т-30а, Т-31 · риск низкий · последний этап программы

REQUIRED SUB-SKILL: superpowers:subagent-driven-development (выполнено одним агентом последовательно — объём связный, файлы пересекаются)

## Задачи

- [x] `import/oneCAccountCard/create-org.ts`: `createOrgFromQueueRow` — права `mayImportOneC`, скоуп строки, `bad_inn`/`org_exists`/`company_required`, компания по Т-41, `externalId: null`, привязка через `resolveQueueRow` (`bind_failed` с id), аудит `organization_created_manual` (Т-30)
- [x] server action `createOrgFromQueueRowAction` (+revalidate обеих payments-страниц)
- [x] `payment-queue-table.tsx`: кнопка «Создать организацию» у строк с ИНН + диалог (prefill, селект компании для admin, DaData-подтяжка Т-31 через `/api/suggest/party`, русские ошибки)
- [x] payments-страницы (admin + leader): проп `companies` для admin-таблицы
- [x] Тест-страж Т-30а: новый ИНН → `route: 'queue'`, 0 новых организаций (unit матчера + integration через `commitPaymentImport`)
- [x] Тесты: unit create-org, unit таблицы (jsdom), integration сквозной (создание из очереди → организация в нужной компании, платёж привязан, строка resolved, аудит)
- [x] Гейты: typecheck, lint, prettier, покрытие изменённых 100%, полный integration на свежей seed-базе, полный unit; никаких неиспользуемых экспортов (knip-грабля #326)
- [x] CHANGELOG, close-out, STATUS.md (программа закрывается — финальная запись)
