# Этап 6 «Привязка к компании» — план

**Спека:** [2026-08-06-stage6-1c-company-binding-design.md](../specs/2026-08-06-stage6-1c-company-binding-design.md) — подтверждена заказчиком («ок», 06.08.2026, PR #320)
**ТЗ:** Т-41…Т-44 · риск средний · строго до этапа 7
**Close-out:** [2026-08-06-stage6-1c-company-binding-DONE.md](2026-08-06-stage6-1c-company-binding-DONE.md)

REQUIRED SUB-SKILL: superpowers:subagent-driven-development (выполнено одним агентом последовательно — объём связный, файлы пересекаются)

## Задачи

- [x] `oneCSync/config.ts`: `oneCDefaultCompanyId()` из `ONE_C_COMPANY_ID`
- [x] `oneCSync/writers.ts`: `WriteCtx.createCompanyId`; create-ветка без `company.create` (компания по §4.1 спеки, нет → `failed: company_not_configured`); `mayCreateOrg` + скоуп `company`, комментарий переписан (Т-41, Т-43)
- [x] `worker/processors/sync-organizations.ts`: `createCompanyId` из конфига, `log.error` при отсутствии
- [x] `import/index.ts`: `Args.companyId`, код `company_required`, резолв компании для `global` до батчей (одна → дефолт)
- [x] `server-actions/import.ts`: прокидка `companyId` из FormData
- [x] `app/admin/settings/integrations/1c/excel/page.tsx`: список компаний → форме
- [x] `components/import/import-form.tsx`: селект «Компания для новых организаций» (обязателен при >1; при одной — подпись, значение уходит само)
- [x] `components/import/error-messages.ts`: текст `company_required`
- [x] `oneCSync/backfill-orphans.ts` (новый сервис) + `scripts/backfill-orphan-companies.ts` (CLI) + npm-скрипт (Т-42)
- [x] Тесты: unit (writers/config/index/form/инвариант/бэкфилл) + integration этапа 6 (Т-44 `company.count()`, путь руководителя, `company_not_configured`, бэкфилл с decoy)
- [x] Волна: stage5-integration (своя Company + `companyId` в args), stage4-partner (`createCompanyId`), unified, unit-моки `company: { create`/`$transaction`, инвариант C8
- [x] Гейты: typecheck, lint, prettier, покрытие изменённых 100%, integration локально, полный `test:unit`
- [x] CHANGELOG (влияние на сетевую синхронизацию!), close-out, STATUS.md
