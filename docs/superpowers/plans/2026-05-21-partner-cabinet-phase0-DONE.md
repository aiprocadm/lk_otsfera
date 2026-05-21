# Phase 0 — DONE

**Дата завершения:** 2026-05-21
**Base commit (до Phase 0):** `7963580` (docs: partner cabinet design spec + phase 0 plan)
**Head commit Phase 0:** `4d35963` (feat(worker): wire fake adapter pull into sync-orders with logging)

## Что готово

### Schema (Tasks 1-13)
- 8 новых enums: `ExecutionStatus`, `FinancialStatus`, `DocumentType`, `DocumentDirection`, `GenerationSource`, `NotificationType`, `LeadStatus`, `CommissionStatementStatus`
- Расширены 5 существующих моделей: `Partner` (+commissionRate/legalName/slug), `Organization` (+1С linkage + per-org commission override), `Order` (двухмерный статус + totals + 1С linkage), `Document` (type/direction/version + nullable uploadedBy)
- 8 новых моделей: `PartnerUser`, `Lead`, `LeadAttachment`, `CommissionStatement`, `CommissionStatementItem`, `Payment`, `SavedView`, `SyncLog`
- Миграция `20260521150000_partner_cabinet_phase0` применена; pre-existing init migration починена отдельной миграцией `20260521120000_student_bridge_grant_and_fk_fix`
- Integration smoke (real DB): `schema.integration.test.ts` — Partner, PartnerUser, Lead+attachments, SyncLog

### Infrastructure (Tasks 14-17)
- Redis 7-alpine в `docker-compose.yml` с healthcheck + appendonly persistence
- `bullmq@5.76`, `ioredis@5.10` установлены
- `src/lib/jobs/` — connection, queues registry (10 queue names), payload types
- `src/worker/index.ts` — BullMQ worker entrypoint с SIGINT/SIGTERM graceful shutdown
- npm scripts: `worker`, `worker:dev`

### 1С adapter scaffolding (Tasks 18-22)
- `src/lib/services/oneCSync/`:
  - `adapter.ts` — OneCAdapter interface (4 pull + 1 push)
  - `dto.ts` — runtime-independent DTO types
  - `adapter-fake.ts` + `fixtures/` — реалистичные тестовые данные (3 orgs, 3 orders, 3 payments, 3 documents)
  - `index.ts` — factory keyed by `ONE_C_ADAPTER` env (fake | rest | file)
  - `log.ts` — `writeSyncLog()` helper
  - `mappers.ts` — pure 1С DTO → Prisma upsert input mappers

### Deliverables (Tasks 23-25)
- `docs/integrations/1c-contract.md` — Draft контракта для IT 1С (5 эндпоинтов, auth options, идемпотентность, 9 открытых вопросов, stakeholders)
- Worker E2E smoke: enqueue → BullMQ pickup → FakeOneCAdapter.pullOrders → SyncLog row persisted
- Final verification: `npm test` 74 passed / `npm run typecheck` 0 errors / `npm run build` successful

## Что НЕ готово (по плану — следующие фазы)

- **Phase 1 (Partner Foundation, 2 нед):** UI портфолио организаций, управление командой партнёра, RBAC sub-roles
- **Phase 2 (Deals + Documents, 2 нед):** список сделок партнёра, документы по сделкам, leads UI
- **Phase 3 (Real 1С + sync, 2 нед):** REST/file адаптер, реальный upsert в БД через mappers, конфликт-резолв, scheduled jobs
- **Phase 4 (Commission calc, 1.5 нед):** расчёт комиссии по периодам, PDF/XLSX генерация, approval workflow
- **Phase 5 (Mobile + polish, 1 нед):** PWA shell, card-list view, bottom tab-bar, real-device QA

## Проверка состояния

```bash
# DB schema
npx prisma migrate status              # expect "Database schema is up to date"

# Tests
npm test                               # expect 74 passed
npm run typecheck                      # expect 0 errors
npm run build                          # expect successful

# Worker smoke (требует docker compose up -d db redis)
npm run worker                         # term 1
# В term 2:
node -e "const{Queue}=require('bullmq');const IORedis=require('ioredis');const c=new IORedis(process.env.REDIS_URL||'redis://localhost:6379');new Queue('oneCSync.pullOrders',{connection:c}).add('smoke',{triggeredAt:new Date().toISOString(),reason:'manual'}).then(j=>{console.log('enq',j.id);c.quit();});"

# Check SyncLog
docker exec promtech-cabinet-db-1 psql -U postgres -d cabinet -c 'SELECT entity, status, payload FROM "SyncLog" ORDER BY "createdAt" DESC LIMIT 5;'
```

## Deviations from плана

1. **Task 1 test переписан с runtime-import на schema-text parse.** Prisma 5 tree-shake'ает unused enums, поэтому `Object.values(ExecutionStatus)` падает между Tasks 1 и 4+. Schema-text test устойчивее.
2. **Tasks 2-11 поделены на scalar fields (сейчас) + back-relations (когда модель оппонента добавляется).** План предлагал forward-references `partnerUsers PartnerUser[]` до того как PartnerUser существует — Prisma валидирует и падает. Атомарность каждого таска сохранена.
3. **Pre-existing migrations были сломаны.** init migration (`20260510120000_init`) был 62-byte stub с пустым SQL. `_prisma_migrations` помечал его applied, но таблиц не было. Восстановлен SQL через `prisma migrate diff` против схемы at init commit `d3e0b0c`. Также добавлена fix-миграция для `StudentBridgeGrant` (drift из db push без миграции) и FK `User.companyId` (ON DELETE SET NULL после nullable в role_cabinets). Это в отдельном commit `aa51e6e` — не относится к Phase 0 но был блокером.
4. **Task 12 миграция сгенерирована через `prisma migrate diff`, не `migrate dev`.** Последний требует TTY для подтверждения warning'ов про unique constraints (на newly nullable externalId/slug — все warnings safe, потому что колонки новые).
5. **`@types/ioredis` не установлен.** ioredis 5+ ships с собственными типами, DefinitelyTyped пакет был бы конфликтом.
