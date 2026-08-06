# Этап 7 «Роли: админ + руководитель» — план

**Спека:** [2026-08-06-stage7-1c-roles-design.md](../specs/2026-08-06-stage7-1c-roles-design.md) — подтверждена заказчиком («ок», 06.08.2026, PR #322)
**ТЗ:** Т-25…Т-29 · риск средний · после этапа 6

REQUIRED SUB-SKILL: superpowers:subagent-driven-development (выполнено одним агентом последовательно — объём связный, файлы пересекаются)

## Задачи

- [x] `lib/auth/managerPolicy.ts`: + `mayImportOneC` (admin ∨ leader) + строка в guard-тесте матрицы (Т-25, Т-26)
- [x] `import/index.ts`, `oneCAccountCard/import-batch.ts`: `isStaff` → `mayImportOneC`
- [x] `lib/navigation/settings.ts`: `LegacyRoute.cabinet?`, `integrations.oneC.cabinets` + leader, 2 legacy-пути `/manager/*` → leader-хаб
- [x] `next.config.mjs`: + 2 строки `SETTINGS_HUB_REDIRECTS` (drift-тест сверит)
- [x] `OneCTabs`: проп `cabinet` (дефолт admin — существующее использование не меняется)
- [x] Новые страницы `app/leader/settings/integrations/1c/{layout,page,excel,payments}` — leader-гард, excel без селекта компаний
- [x] Шлюзы `app/manager/import` и `app/manager/payments-import`: `redirectToSettingsHub` + fallback = leader-страница (её гард отбивает обычного менеджера в `/forbidden`)
- [x] `lib/navigation/cabinet.ts`: `leaderOnly: true` у двух пунктов
- [x] Т-29: README/RUNBOOK — флаги на проде
- [x] Тесты: unit (managerPolicy+матрица, import-сервисы forbidden/ok, страницы, шлюзы, nav, канон разделов leader) + integration (leader через сервис; перевод import.contract/unified с manager-сессий)
- [x] Гейты: typecheck, lint, prettier, покрытие изменённых 100%, ПОЛНЫЙ integration локально, полный unit
- [x] CHANGELOG (поведенческое изменение для менеджеров!), close-out, STATUS.md
