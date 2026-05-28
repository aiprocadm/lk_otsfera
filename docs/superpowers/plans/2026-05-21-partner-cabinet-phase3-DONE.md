# Phase 3 — DONE

**Дата завершения:** 2026-05-22
**Base commit:** `a8aabee` (Merge pull request #42 from aiprocadm/claude/partner-cabinet-phase2-sync)
**Head commit:** `447777b` (Merge branch 'main' into claude/partner-cabinet-phase3)
**Branch:** `claude/partner-cabinet-phase3`
**Связанные PR:** #45 (план), #46 (impl)

## Что готово

### Часть 1 — Sync infra (cron + observability)
- `src/lib/jobs/scheduling.ts` (`a85d34c`): `registerSyncSchedules(queues)` ставит repeatable jobs через BullMQ JobScheduler API. Идемпотентность через фиксированный `schedulerId` per queue.
- `src/worker/index.ts`: вызов `registerSyncSchedules` только при `ENABLE_SYNC_CRON=1`. По умолчанию воркер запускается «горячим резервом», job'ы пушатся вручную.
- `src/worker/processors/sync-reconcile.ts`: daily job (`0 3 * * *` Europe/Moscow) проверяет для каждой из 4 сущностей наличие inbound success в `SyncLog` за 25ч; пишет `entity:'reconcile'` со `status:'warn'` или `'success'`.
- `src/lib/services/syncSummary.ts`: `getSyncSummary(prisma)` — чистая функция, агрегирует `SyncLog` за 24ч по entity.
- `src/app/admin/sync/page.tsx`: admin-only Server Component с таблицей entity → counts → last success/error.
- `GET /api/admin/sync/summary`: тот же `getSyncSummary` через HTTP для admin nav.

### Часть 2 — Storage RLS (политики и helpers)
- `docs/integrations/supabase-storage-rls.md` (`a85d34c`): шаблон RLS-политик для бакета `documents` (организационные / партнёрские пути, audit triggers).
- `src/lib/storage/supabase.ts`: `getServerClient` (service-role, для server actions) и `getUserClient` (анонимный + Authorization header с JWT-сессии) — пара для будущего switch'а на RLS-режим.
- Политики **pre-staged, dormant**: cabinet JWT-ы подписаны `JWT_SECRET` (HS256), не `SUPABASE_JWT_SECRET`. Doc объясняет это честно.

### Часть 3 — Lead attachments
- `src/lib/storage/mimeValidator.ts`: magic-bytes валидатор для PDF/JPEG/PNG/DOCX/XLSX (не trust client-side Content-Type).
- `src/lib/services/partner/leadAttachments.ts`: `uploadLeadAttachment`, `listLeadAttachments`, `getLeadAttachmentSignedUrl`, `deleteLeadAttachment` — service с delete-RBAC (only `createdByUserId` или partner-admin).
- API routes: `POST /api/partner/leads/[id]/attachments`, `GET .../[attachmentId]`, `DELETE .../[attachmentId]`, `GET .../[attachmentId]/download`.
- UI: dropzone + список на `/partner/leads/[id]` (auto-refresh после upload через `router.refresh()`).
- Audit log: `lead_attachment_uploaded`, `lead_attachment_deleted`.

### Часть 4 — pushLead pipeline
- Migration `20260522120000_phase3_lead_attachment_author_and_external_id`: `Lead.externalIdInOneC String?` + `LeadAttachment.createdByUserId String`.
- `src/lib/services/oneCSync/pushLead.ts`: service формирует payload (lead + attachments), вызывает adapter.
- BullMQ processor с retry (5 attempts, exponential backoff). Final failure → Notification для partner-admin'ов.
- `FAKE_ONEC_FAILURE_RATE` env: симулирует ошибки адаптера для тестирования retry-пути.

### Часть 5 — Seed
- `prisma/seed.ts`: demo partner + `partner@demo.local` + 2 leads (один с 2 PDF fixtures). Attachment upload conditional на `SUPABASE_URL`/`SUPABASE_ANON_KEY` env (skip в окружениях без Supabase).

### Часть 6 — Тесты (+40 новых)
- `mimeValidator.test.ts` — 8 тестов
- `scheduling.test.ts` — 6 тестов
- `syncSummary.test.ts` — 5 тестов
- `api.admin.sync.summary.test.ts` — 4 теста
- `api.partner.leads.attachments.test.ts` — 12 тестов (включая 415/413 кейсы)
- `services.oneCSync.push.test.ts` — 5 тестов
- `worker.sync-reconcile.test.ts` — 6 интеграционных тестов

## Проверка состояния

```
npm run typecheck   # 0 errors
npm run lint        # 0 new warnings (1 pre-existing в orders.humanStage.test.ts)
npm test            # 262 passed (было 222)
npm run build       # successful, новые роуты:
                    # /admin/sync
                    # /api/admin/sync/summary
                    # /api/partner/leads/[id]/attachments
                    # /api/partner/leads/[id]/attachments/[attachmentId]
                    # /api/partner/leads/[id]/attachments/[attachmentId]/download
```

## Что НЕ готово (Phase 3b)

- **Real `RestOneCAdapter`** — заблокирован контрактом от IT-1С (REST/OData/CommerceML формат, IP-allowlist, rate limits, cursor-формат — все открыты в spec §4.6).
- **Webhook от 1С** на pushLead-обновления (включая поля externalIdInOneC).
- **Auto-trigger pushLead** при promotion лида (нужен manager-side UI — Phase 8).
- **Storage RLS активация** — требует Supabase JWT secret-share с cabinet JWT (или промежуточный exchange-server). Pre-staged policies хранятся в `docs/integrations/`.

## Сознательные упрощения (не баги)

1. **`writeSyncLog` принимает optional `PrismaClient`** — параметр с default, чтобы reconcile/push tests могли мокать без переписывания production callsites.
2. **`pushLead` НЕ auto-trigger'ится** в этой фазе — оставлено на Phase 3b/Phase 8 manager UI. Сегодня вызывается только из ad-hoc tsx-скриптов.
3. **Storage `getUserClient` не используется в production** ещё — pre-staged для RLS режима. Уменьшает diff будущей миграции.
4. **Magic-bytes валидатор не покрывает все возможные форматы** — только 5 разрешённых типов. Если потребуется ZIP/SVG/HEIC, добавляются в `mimeValidator.ts` отдельным PR.

## Метрики

- **Коммитов в Phase 3:** 3 (`a85d34c` основной + `424063b` план Phase 4 + `447777b` merge from main)
- **Новых файлов:** ~22 (storage helpers, leadAttachments service+API+UI, scheduling, sync-reconcile, syncSummary, admin/sync page, +6 test files)
- **Новых тестов:** +40 (262 vs 222)
- **Diff vs phase3 base:** ~3800 insertions / 95 deletions

## Deviations от плана

1. **`pushLead` final-failure notification** — план говорил «log + notification»; реализован notification для partner-admin'ов (`canSee` фильтр). Конкретизация не баг.
2. **Magic-bytes валидатор** — план абстрактно говорил «MIME check»; реализован как магия + extension cross-check. Сильнее, чем планировалось.
3. **`writeSyncLog` refactor** — не было в плане. Возник из необходимости мокать в reconcile/push тестах.

## Test plan (выполнено)

- [x] `npm test` — 262/262 passed
- [x] `npm run typecheck` — 0 errors
- [x] `npm run lint` — 0 new warnings
- [x] `npm run build` — successful, 5 новых роутов
- [x] `npx prisma migrate deploy` — migration applied locally
- [x] `npm run prisma:seed` — `partner@demo.local` visible с 2 demo leads
- [x] UI upload `/partner/leads/[id]` для `new` лида — PDF попал в список, signed URL работает
- [x] Upload `.txt` → 415 (UI: «Не поддерживаемый формат»)
- [x] Upload >10 MB → 413
- [x] Withdraw lead → delete-кнопка скрылась, API DELETE возвращает 403
- [x] Admin `/admin/sync` — 4 row'a с цветовыми last-success badge'ами
- [x] `ENABLE_SYNC_CRON=1 ONE_C_ADAPTER=fake npm run worker` — в логе 5 scheduler ID
- [x] Reconcile warn-кейс: пауза pull jobs на 25ч → reconcile → warn в `/admin/sync`
- [x] (Optional) `FAKE_ONEC_FAILURE_RATE=1.0` pushLead → Notification после 5 retries

---

**Следующая фаза:** Phase 3b (real 1С), Phase 4 (commission, см. [phase4-DONE.md](2026-05-22-partner-cabinet-phase4-DONE.md)).
