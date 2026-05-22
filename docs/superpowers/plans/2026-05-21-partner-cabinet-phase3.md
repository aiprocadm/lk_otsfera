# Phase 3 — Plan: Sync hardening, Storage RLS, Lead attachments

**Дата начала:** 2026-05-22
**Base commit (main после PR #42 merge):** `a8aabee` (Merge pull request #42 from aiprocadm/claude/partner-cabinet-phase2-sync)
**Branch:** `claude/partner-cabinet-phase3`
**Spec reference:** `docs/superpowers/specs/2026-05-21-partner-cabinet-design.md` §§ 4 (интеграция с 1С), 5.6 (заявки/лиды), 6.1 (хранилище документов), 6.2 (валидация загрузок), 7.4 (Storage RLS), 9.1 (Phase 3).

## Цель фазы

Phase 0–2 закрыли каркас, портфель, лиды и интерактивные сделки партнёрского кабинета. Phase 3 по §9.1 спеки — «Реальный 1С». Однако открытые вопросы для IT 1С (§4.6 спеки: интерфейс REST/OData/CommerceML, IP-allowlist, rate limits, идентификация партнёра, datetime-формат, cursor для инкрементальных синков, push-эндпоинт для лидов) **до сих пор не закрыты**. Без них реальный `RestOneCAdapter` написать нельзя без риска переделки.

Поэтому Phase 3 расщеплена на:

- **Phase 3 (этот план)** — всё, что не блочится на IT 1С: harden sync-инфраструктуру (scheduling, reconcile, observability), реализовать Storage RLS и Lead attachments UI, написать `pushLead`-скелет против `FakeOneCAdapter`. После этой фазы ветка `oneCSync` готова к переключению `ONE_C_ADAPTER=rest` одним env-флагом.
- **Phase 3b (отдельный план, когда будет контракт от IT)** — `RestOneCAdapter`, webhook от 1С, реальный авто-trigger `pushLead` при promotion лида (manager UI).

## Что входит в Phase 3

### Часть 1 — Sync scheduling (cron-based BullMQ)

- `src/lib/jobs/scheduling.ts` — экспорт `registerSyncSchedules(queues)` ставит repeatable jobs через BullMQ JobScheduler API (v5: `queue.upsertJobScheduler(schedulerId, { pattern, tz: 'Europe/Moscow' }, { data })`):
  - `oneCSync.pullOrders` — `*/15 * * * *`
  - `oneCSync.pullPayments` — `*/15 * * * *`
  - `oneCSync.pullDocuments` — `0 * * * *`
  - `oneCSync.pullOrganizations` — `0 */6 * * *`
  - `oneCSync.reconcile` — `0 3 * * *` (см. Часть 2)
  - Идемпотентность: фиксированный `schedulerId` per queue → повтор регистрации не дублирует.
- `src/worker/index.ts` — вызвать `registerSyncSchedules(queues)` в startup, но только если `ENABLE_SYNC_CRON === '1'`. Иначе worker запускается «горячим резервом» и job'ы пушатся только вручную.
- Конструкция `triggeredAt`, `reason: 'cron'` для payload отличает плановые job'ы от ручных в SyncLog.

### Часть 2 — Reconcile job

- `src/worker/processors/sync-reconcile.ts` — раз в сутки (`0 3 * * *` Europe/Moscow):
  - Для каждой из 4 сущностей (`organization`, `order`, `payment`, `document`) проверяет: есть ли в `SyncLog` за последние 25 часов запись `direction='inbound', status='success'`.
  - Если хотя бы по одной нет — пишет `SyncLog{entity:'reconcile', status:'warn', payload:{missing:[...]}}`.
  - Если все 4 свежие — `SyncLog{entity:'reconcile', status:'success', payload:{checkedAt}}`.
- Никаких лечащих действий не предпринимает — это сигнал для `/admin/sync` и оператора.

### Часть 3 — Sync observability

- `src/lib/services/syncSummary.ts` — чистая функция:
  ```ts
  getSyncSummary(prisma): Promise<{
    entity: string;
    successCount24h: number;
    warnCount24h: number;
    errorCount24h: number;
    lastSuccessAt: Date | null;
    lastErrorAt: Date | null;
    lastErrorMessage: string | null;
  }[]>
  ```
  Группирует `SyncLog` по `entity` для inbound-операций за 24 часа + последняя успешная/ошибочная запись.
- `GET /api/admin/sync/summary` — admin-only, отдаёт результат `getSyncSummary`.
- `src/app/admin/sync/page.tsx` — admin-only Server Component:
  - Заголовок «Состояние синхронизации с 1С».
  - Таблица: Сущность / Успехов 24ч / Предупреждений / Ошибок / Последний успех / Последняя ошибка.
  - Свежесть «last_success_at» окрашивается: ≤2ч — зелёный, 2-24ч — жёлтый, >24ч — красный.
- Доступ через `requireAdmin` (уже есть в `src/lib/auth`).
- В `src/lib/navigation/cabinet.ts` добавить `navByRole.admin` пункт «Синхронизация».

### Часть 4 — Storage RLS для bucket `documents`

- `docs/integrations/supabase-storage-rls.md` — документация политики:
  - Read для пользователей с `partner_id` JWT-claim: `storage.objects` WHERE `bucket_id = 'documents' AND name LIKE 'partners/' || (auth.jwt() ->> 'partner_id') || '/%'`.
  - Read для org-пользователей по `org_id` claim: WHERE `name LIKE 'partners/%/organizations/' || (auth.jwt() ->> 'org_id') || '/%'`.
  - Write — полностью запрещён клиенту, только server-side через service-role key.
  - SQL-snippet для применения через Supabase Dashboard / CLI.
- `src/lib/auth/jwt.ts` — расширить `SessionPayload` claim'ом `partner_id` (для partner-роли) и `org_id` (для organization-роли). Существующие JWT этого не имеют — добавить с graceful миграцией (старые токены продолжают работать до естественной экспирации).
- `src/lib/storage/supabaseClient.ts`:
  - `getServerClient()` — service-role, для server-side операций (uploads, signed URL generation).
  - `getUserClient(jwtCookie)` — anon-key + user JWT, для прокидывания RLS-проверки в Supabase (опционально, пока не используется — заглушка под будущее).
- Обратная совместимость: пути уже в формате `partners/{partnerId}/...` — Phase 2 storage пишет именно так, миграция данных не нужна.

### Часть 5 — Lead attachments upload + UI

- `src/lib/services/partner/leadAttachments.ts`:
  - `uploadLeadAttachment({ leadId, partnerId, file: { buffer, name, mimeType, size } })` — валидация (см. §6.2 спеки), путь `partners/{partnerId}/leads/{leadId}/{cuid}.{ext}`, запись в `LeadAttachment`, audit log `lead_attachment_uploaded`.
  - `deleteLeadAttachment({ attachmentId, partnerId, userId })` — допустимо только когда `lead.status ∈ (new, in_review)` И (`createdByUserId = userId` ИЛИ user — partner-admin). Иначе `FORBIDDEN`.
  - `getLeadAttachmentDownloadUrl({ attachmentId, partnerId })` — Supabase signed URL TTL=5мин.
- `src/lib/storage/mimeValidator.ts` — magic-bytes-проверка для PDF (`%PDF`), JPEG (`FF D8 FF`), PNG (`89 50 4E 47`), DOCX/XLSX (zip `50 4B 03 04` + проверка `[Content_Types].xml`). Прочие MIME → 415 Unsupported Media Type.
- `POST /api/partner/leads/[id]/attachments` — multipart, scope-чек через `requirePartner`, размер ≤ `DOCUMENT_MAX_FILE_SIZE_MB` (env, дефолт 10).
- `GET /api/partner/leads/[id]/attachments/[attachmentId]/download` — выдаёт `307 Redirect` на signed URL.
- `DELETE /api/partner/leads/[id]/attachments/[attachmentId]`.
- `src/components/partner/lead-attachment-dropzone.tsx` — client component, drag-and-drop + клик; используется на `/partner/leads/new` и `/partner/leads/[id]`.
- `src/components/partner/lead-attachments-list.tsx` — таблица: иконка-тип / имя / размер / дата загрузки / [⬇] / [🗑] (последняя кнопка скрыта если статус блокирует delete).
- `src/app/partner/leads/[id]/page.tsx` — секция «Вложения» под notes.

### Часть 6 — `pushLead` outbound skeleton

- `src/lib/services/oneCSync/adapter.ts` — расширить интерфейс `OneCAdapter` опциональным методом:
  ```ts
  pushLead?(dto: OneCLeadPushDto): Promise<OneCLeadPushResult>;
  ```
- `src/lib/services/oneCSync/dto.ts` — новые типы `OneCLeadPushDto`, `OneCLeadPushResult`.
- `src/lib/services/oneCSync/adapter-fake.ts` — `pushLead`: пишет в in-memory массив, возвращает `{ externalId: 'fake-lead-' + cuid(), accepted: true }`. С 10%-вероятностью симулирует ошибку (для проверки retry) — управляется env `FAKE_ONEC_FAILURE_RATE`.
- `src/lib/services/oneCSync/push.ts` — `pushLeadToOneC(lead, opts?)`:
  - Маппит `Lead` → `OneCLeadPushDto`.
  - Вызывает `adapter.pushLead`.
  - Пишет `SyncLog{entity:'lead', direction:'outbound', operation:'create', status: ...}`.
  - При успехе: обновляет `Lead` с `externalIdInOneC` (новое поле — см. ниже миграция).
- Миграция: добавить `Lead.externalIdInOneC String?` (новое опциональное поле). Миграция non-breaking.
- `src/worker/processors/push-lead.ts` — BullMQ processor с retry: 5 попыток, exponential backoff 1s базы. На final failure — `SyncLog{status:'error'}` + (опционально) Notification для partner-admin.
- `src/lib/jobs/queues.ts` — зарегистрировать очередь `oneCSync.pushLead`.
- **НЕ триггерится автоматически в Phase 3.** Внутри сервиса есть только функция, которую можно вызвать вручную через `tsx` или будущий manager UI promotion endpoint (Phase 3b/4). Это позволяет полноценно тестировать поведение очереди без зависимости от manager-UI.

### Часть 7 — Расширение seed

- `prisma/seed.ts`:
  - После создания партнёра и users — создать 2 демо-лида у `partner@demo.local`:
    - 1 со статусом `new` без вложений.
    - 1 со статусом `in_review` с двумя вложениями (положить фейковые PDF в `prisma/seed-fixtures/lead-attachments/*.pdf`, загрузить через сервис `uploadLeadAttachment` чтобы пройти Storage).
  - Это даст партнёру в UI готовую страницу с вложениями для smoke-теста.

### Часть 8 — Тесты

- `src/__tests__/services.syncSummary.test.ts` — unit, мокаем prisma:
  - агрегация count по статусам за 24ч,
  - lastSuccessAt/lastErrorAt берутся корректно,
  - пустой результат когда логов нет.
- `src/__tests__/api.admin.sync.summary.test.ts` — unit, проверка RBAC (admin only) и формы ответа.
- `src/__tests__/services.partner.leadAttachments.test.ts` — integration (живой PG, как `services.partner.team.test.ts`):
  - upload валидного PDF → запись в `LeadAttachment` + объект в storage (mock или реальный),
  - upload не-PDF (`text/plain` с фейковыми magic bytes) → reject 415,
  - delete для status='new' (creator) → OK,
  - delete для status='qualified' → FORBIDDEN,
  - delete чужого вложения partner-manager'ом без admin-роли → FORBIDDEN,
  - download партнёром-менеджером без org в `assignedOrgIds` (если лид прикреплён к организации) → 404.
- `src/__tests__/api.partner.leads.attachments.test.ts` — unit с моком сервиса:
  - POST 415 на bad MIME,
  - POST 413 на превышение размера,
  - DELETE 403 на чужой/неактивный статус.
- `src/__tests__/worker.push-lead.test.ts` — integration:
  - happy path → SyncLog success + Lead.externalIdInOneC заполнен,
  - failure path (FAKE_ONEC_FAILURE_RATE=1.0) → SyncLog error,
  - проверка retry exhaust → Notification партнёру-админу.
- `src/__tests__/services.oneCSync.scheduling.test.ts` — unit, мокаем `Queue.upsertJobScheduler`:
  - повторная регистрация с тем же schedulerId не вызывает `add`,
  - все 5 расписаний (4 pull + reconcile) регистрируются с правильными pattern'ами и tz.
- `src/__tests__/mimeValidator.test.ts` — unit на каждый supported тип + edge cases (truncated header, mismatched extension).

## Что НЕ делаем в Phase 3

Эти пункты — отдельный план **Phase 3b** (когда IT 1С отдаст контракт):

- **`RestOneCAdapter`** — реальная имплементация HTTP/OData/CommerceML клиента, OAuth/Basic/mTLS-auth, cursor для инкрементальных синков. Блочится на §4.6 спеки.
- **Webhook от 1С** (`POST /api/integrations/1c/webhook`) — нужно знать формат payload, HMAC-secret, может ли 1С пушить вообще.
- **Авто-trigger `pushLead`** при promotion лида — нужен manager-side UI (внутри `/admin` или `/manager`). Запланирован в Phase 4 вместе с финансовой страницей.

Из спеки также вне scope этой фазы:

- **PDF/Excel генерация комиссии** (§6.5-6.6) — Phase 4.
- **`OrderItem`/`Product` каталог** — §3.3 спеки явно откладывает.
- **ClamAV async scan вложений** — §6.2 п.4 отмечает «(Phase 2)»; в текущем смысле — отдельный план после Phase 4.
- **PWA polish** (иконки, splash, offline) — Phase 5.

## Сознательные упрощения Phase 3

1. **Sync cron включается только под флагом** `ENABLE_SYNC_CRON=1`. В dev/тестах он выключен, чтобы repeat-jobs не подвешивали процесс и тесты. В prod флаг выставляется в env воркера.
2. **Reconcile только сигнализирует** через `SyncLog`, ничего не лечит. Самолечение — не раньше Phase 5.
3. **Storage RLS = документация + SQL-snippet**, не автоматическая Prisma-миграция. Supabase storage policies живут отдельно от Postgres-схемы; применяем через Supabase Dashboard или CLI вручную. Чек-лист применения — в `docs/integrations/supabase-storage-rls.md`.
4. **Lead attachment DELETE** доступен только пока `lead.status ∈ (new, in_review)`. После promotion/rejection — read-only, чтобы аудит-trail оставался полным. Если партнёру нужно «убрать» вложение после — он отзывает лид и создаёт новый (та же логика, что в Phase 2 для редактирования полей).
5. **MIME-валидация** — фиксированный allowlist (PDF/JPEG/PNG/DOCX/XLSX). Прочие типы отклоняются. Это покрывает 95% реальных вложений и упрощает supply-chain (не нужны экзотические парсеры).
6. **`pushLead` без авто-trigger.** Phase 3 строит инфраструктуру (queue + processor + retry), но не подключает её к промоушену лидов — это работа Phase 3b, когда появится контракт 1С на push.
7. **`Lead.externalIdInOneC`** — новое опциональное поле, заполняется только когда push реально дойдёт до 1С (в Phase 3 — только в worker-тестах против FakeAdapter). Без этого поля невозможно отслеживать состояние outbound-синков на уровне сущности.

## Метрики приёмки

- `npm test` — все Phase 2 тесты + новые проходят (integration тесты живой БД skipped без `DATABASE_URL`, как и в Phase 1/2).
- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 новых warnings (старые pre-existing допустимы).
- `npm run build` — successful, +1 admin-роут (`/admin/sync`), +3 API-роута (`/api/admin/sync/summary`, `/api/partner/leads/[id]/attachments`, `/api/partner/leads/[id]/attachments/[attachmentId]/download` и DELETE на ту же ручку).
- `npm run prisma:seed` → `partner@demo.local` видит на `/partner/leads/[id]` 2 PDF-вложения, может скачать оба, не может удалить (если лид уже `in_review`).
- `ENABLE_SYNC_CRON=1 ONE_C_ADAPTER=fake npm run worker` → в логе старта видны 5 зарегистрированных schedulerId; первый цикл pullOrgs прошёл через ≤ 6 часов (можно проверить ускоренно с `tz` override или ручным `*/1`).
- `/admin/sync` показывает 4 строки sync-сущностей с актуальными счётчиками и цветовой индикацией.

## Зависимости

Всё уже есть в кодовой базе:

- BullMQ 5.76.10 (`upsertJobScheduler` API доступен с v5.5).
- Supabase Storage bucket `documents` создан в Phase 0.
- `jose` JWT, `JWT_SECRET` env.
- Prisma модели `Lead`, `LeadAttachment` — Phase 0.
- `requireAdmin`, `requirePartner` API guards — Phase 1.
- Service Layer паттерн `services/partner/*` + integration-тесты против живой PG — Phase 1/2.
- `FakeOneCAdapter` + `SyncLog` — Phase 0.
- Никаких новых внешних библиотек.

## Открытые вопросы для пользователя/IT (для Phase 3b)

Нужно закрыть до старта Phase 3b. Phase 3 (этот план) их не блочит. Источник — §4.6 спеки, дублируется здесь для удобства:

- [ ] **Интерфейс 1С**: REST HTTP-сервисы / OData / CommerceML / файловые выгрузки?
- [ ] **Аутентификация**: bearer token / basic / mTLS / IP-only?
- [ ] **IP-allowlist**: с какой подсети ходит наш worker, чтобы 1С пропускал?
- [ ] **Rate limits 1С**: запросов/мин и/или в час?
- [ ] **Структура «партнёра» в 1С**: справочник, поле на контрагенте, GUID, slug, ИНН партнёра?
- [ ] **Cursor для инкрементальных синков**: timestamp / version / event-log?
- [ ] **Datetime-формат**: UTC ISO-8601 или московское/локальное время?
- [ ] **Push leads**: какой endpoint в 1С принимает заявку партнёра, формат payload, обязательные поля?
- [ ] **Webhook от 1С**: умеет ли 1С слать webhook на наш endpoint? Если да — HMAC-secret и формат payload?
- [ ] **Бизнес-стадии заказа** в 1С → как мапить в `executionStatus`?

## Test plan (для исполнителя)

Чек-лист, который должен пройти исполнитель плана:

- [ ] `npm test` зелёный (включая новые тесты Phase 3)
- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run lint` — 0 новых warnings
- [ ] `npm run build` — successful
- [ ] Manual smoke: `partner@demo.local` загружает PDF на `/partner/leads/new`, видит в `/partner/leads/[id]`, скачивает по подписанной ссылке
- [ ] Manual smoke: `partner@demo.local` не может удалить вложение лида в статусе `qualified`/`promoted_to_order`/`rejected` (403 в API, кнопка скрыта в UI)
- [ ] Manual smoke (admin): `/admin/sync` показывает свежие метрики; искусственно остановив worker, видим красную «> 24ч» через сутки (или ускоренно через манипуляцию timestamps в `SyncLog`)
- [ ] Manual (worker): `ENABLE_SYNC_CRON=1 ONE_C_ADAPTER=fake npm run worker` запущен ≥ 30 мин — за это время прошёл хотя бы один `pullOrders` (по `*/15`) и записал в `SyncLog`
- [ ] `npm run prisma:seed` → не падает, создаёт 2 лида с вложениями
- [ ] Lighthouse mobile (375px) для `/partner/leads/[id]` ≥ 85
