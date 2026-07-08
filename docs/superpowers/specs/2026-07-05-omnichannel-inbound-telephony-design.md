# Spec: Омниканал — входящие сообщения (PR-A) + телефония Mango (PR-B)

**Дата:** 2026-07-05
**Источник:** ТЗ_Разработчик lk_otsfera v0.5 §9, §10, §25.3 (единый слой интеграций) + бизнес-ТЗ v0.6 §8, §12; задание «Омниканал — входящие + телефония Mango».
**Статус:** design; решения владельца зафиксированы (scope / inbound-email / auto-bind — см. §0).
**Предпосылка:** треки A–G в `main`. Трек D (каналы уведомлений за единым интерфейсом,
[spec](2026-07-02-track-d-notification-channels-design.md)) отгружен; его §4 «Вне объёма (D6)»
явно оставил приём входящих в тред заявки на будущее — **этот трек его подхватывает**.

**Крупный трек — два PR, один общий фундамент.** PR-A (входящие) и PR-B (телефония) делят
резолвер, слой адаптеров, антивирус-конвейер и точки CRM-карточки; поэтому один design-spec,
но **два отдельных плана** (`2026-07-05-omnichannel-pr-a-inbound.md`,
`2026-07-05-omnichannel-pr-b-telephony.md`). PR-A первым: A2 → A1 → A3, затем PR-B: B1 → B5.

## 0. Решения этой сессии (зафиксированы владельцем)

1. **Объём сессии:** спека + оба плана в `docs/superpowers/`, затем стоп на ревью — код после плана.
2. **Входящая почта:** эталонный адаптер шьётся под **IMAP-поллинг** (fake для v1; переключаемо на
   webhook-провайдера через тот же шов позже). Значит **почта — плановый воркер, а не webhook-роут**.
3. **Автопривязка — только точный уникальный идентификатор.** Всё неоднозначное или совпадение
   только по имени/ИНН → очередь «нераспознанные» для ручной привязки. Никакой нечёткой автопривязки.

## 1. Проблема и контекст (как есть, сверено)

Всё взаимодействие сейчас **исходящее**. Входящих сообщений и телефонии нет (сверено).

- **Исходящий слой каналов готов и инвертируем.** `NotificationChannel { key, isEnabledFor(user),
  send(user, payload) }` ([channels/types.ts](../../../src/lib/notifications/channels/types.ts)),
  реестр [channels/registry.ts](../../../src/lib/notifications/channels/registry.ts), диспетчер
  `dispatchToRecipient`/`deliverToRecipient`
  ([channels/dispatch.ts](../../../src/lib/notifications/channels/dispatch.ts)). Транспорты, которые
  каналы оборачивают: `sendTelegramMessage`, `sendMaxMessage`
  ([lib/max/client.ts](../../../src/lib/max/client.ts)), `sendWhatsAppMessage`
  ([lib/whatsapp/aggregator.ts](../../../src/lib/whatsapp/aggregator.ts)), email через Resend.
  **Ответ из инбокса переиспользует эти транспорты — новый исходящий путь не строим.**
- **Привязки на `User`** — уникальны и годятся для обратного резолвинга: `telegramChatId`,
  `maxChatId`, `whatsappPhone` (все `@unique`), `email @unique`
  ([prisma/schema.prisma](../../../prisma/schema.prisma)). У `Organization` **нет** телефона/email
  (только `inn`, `externalId`, `name`); контактные телефоны/почты живут на `Lead.clientContactPhone`
  /`clientContactEmail`/`clientInn`.
- **Webhook-стабы уже есть** ([api/integrations/telegram/webhook](../../../src/app/api/integrations/telegram/webhook/route.ts),
  [.../max/webhook](../../../src/app/api/integrations/max/webhook/route.ts)) — сейчас только линковка
  `/start <code>`; структурно готовы принимать не-`/start` апдейты. WhatsApp-webhook'а нет.
  `/api/*` **исключён из middleware** — роуты рождаются публичными, безопасность = проверка
  секрета/подписи внутри хендлера (эталон: telegram-webhook — секрет-заголовок → 401 → всегда 200
  для подавления ретраев → побочки best-effort).
- **`Message.authorId` — обязательный FK на `User`** ([schema](../../../prisma/schema.prisma)),
  поэтому входящее от внешнего контакта, не являющегося `User`, **не может** быть тред-`Message` —
  нужна отдельная таблица `InboundMessage`. `OrderThread` — 1:1 на `(orderId, side)`, без archive-флага.
- **S3 + антивирус-конвейер** ([lib/storage/objectStorage.ts](../../../src/lib/storage/objectStorage.ts),
  сервис `persistUploadedDocument`
  [services/documents/upload-core.ts](../../../src/lib/services/documents/upload-core.ts)) ставит
  задачу `docs.scanDocument` c payload **`{ kind: 'document', id }`** — дискриминатор `kind`
  позволяет расширение без параллельного сканера
  ([worker/processors/scan-document.ts](../../../src/worker/processors/scan-document.ts)). Файлы
  отдаются presigned-URL (600 с, 302).
- **Шаблон адаптера — `getOneCAdapter()`**
  ([services/oneCSync/index.ts](../../../src/lib/services/oneCSync/index.ts)): env-ключ
  `ONE_C_ADAPTER=fake|rest`, port-интерфейс, `FakeOneCAdapter` полностью тест-управляем,
  `writeSyncLog(entry, db)` ([services/oneCSync/log.ts](../../../src/lib/services/oneCSync/log.ts)).
- **Инфраструктура очередей/воркера:** `QUEUE_NAMES` + `getQueue`
  ([lib/jobs/queues.ts](../../../src/lib/jobs/queues.ts)); плановые задачи `SYNC_SCHEDULES` +
  `registerSyncSchedules` через `upsertJobScheduler`
  ([lib/jobs/scheduling.ts](../../../src/lib/jobs/scheduling.ts)); регистрация процессора
  `startWorker(queue, processor)` ([worker/index.ts](../../../src/worker/index.ts)). **Guardrail:**
  каждый `src/worker/processors/*.ts` обязан импортироваться хотя бы одним тестом
  ([worker.processor-coverage.guardrail.test.ts](../../../src/__tests__/worker.processor-coverage.guardrail.test.ts)).
- **CRM-карточка организации (G4)** — серверные вкладки по `?tab=` в
  [app/manager/organizations/[id]/page.tsx](../../../src/app/manager/organizations/[id]/page.tsx),
  список вкладок [components/manager/org-card-tabs.tsx](../../../src/components/manager/org-card-tabs.tsx)
  (`history|orders|documents|payments|threads|details`), данные —
  `getOrganizationCard(prisma, session, orgId)`
  ([services/manager/organizationCard.ts](../../../src/lib/services/manager/organizationCard.ts)),
  гард `requireManagerForOrg(orgId)` (teamMode/C8-aware).
- **Фиче-флаги** ([lib/featureFlags.ts](../../../src/lib/featureFlags.ts)): `FEATURE_FLAGS` +
  `OPT_IN_FLAGS`, чтения — middleware `FEATURE_PREFIXES`, nav `flag:`, роут
  `notFoundIfDisabled`/`requireFeature`.

**Безопасность (сквозной инвариант).** Содержимое входящих сообщений и звонков — **данные, а не
команды**: тело сообщения никогда не парсится как инструкция и не исполняется; используется только
как текст для отображения/хранения. Резолвинг — единственная точка авторитетной привязки, и он
экранирует cross-company (C8) и cross-scope (IDOR).

## 2. Решения (зафиксированы)

### 2.1. Модель данных (2 новые таблицы; миграция аддитивна, обратима)

1. **`InboundMessage`** (PR-A) — омниканальное хранилище входящих. Отдельная таблица (не `Message`),
   т.к. отправитель часто не `User`.

   ```prisma
   model InboundMessage {
     id             String   @id @default(cuid())
     createdAt      DateTime @default(now())
     channel        String   // 'telegram' | 'max' | 'whatsapp' | 'email'
     externalId     String   @unique          // id сообщения провайдера → идемпотентность
     senderRef      String                    // chatId / E.164 / email, как пришёл
     senderDisplay  String?                   // имя/хэндл, если провайдер даёт
     subject        String?                   // тема (email)
     body           String
     attachmentPath String?                   // S3-ключ, если есть вложение
     attachmentName String?
     attachmentMime String?
     scanStatus     String   @default("none") // none|pending|clean|infected|error
     scanReason     String?
     resolvedOrgId  String?
     resolvedUserId String?
     threadId       String?                   // OrderThread, если авто-привязка к 1 открытому треду
     companyId      String?                   // из resolved org → скоуп C8
     status         String   @default("unresolved") // unresolved|bound|archived
     boundAt        DateTime?
     boundById      String?

     resolvedOrg    Organization? @relation(fields: [resolvedOrgId], references: [id])
     resolvedUser   User?         @relation(fields: [resolvedUserId], references: [id])
     thread         OrderThread?  @relation(fields: [threadId], references: [id], onDelete: SetNull)
     company        Company?      @relation(fields: [companyId], references: [id])

     @@index([status, createdAt])
     @@index([companyId, createdAt])
     @@index([resolvedOrgId, createdAt])
     @@index([channel, createdAt])
   }
   ```

   Очередь «нераспознанные» = `status:'unresolved'` (⇒ `companyId:null`) — отфильтрованное
   представление, не отдельная таблица. `externalId` уникален глобально; провайдеры гарантируют
   свою уникальность, коллизии между провайдерами исключаем префиксом канала при формировании
   `externalId` (`tg:<id>`, `wa:<id>`, `max:<id>`, `email:<messageId>`).

2. **`Call`** (PR-B):

   ```prisma
   model Call {
     id                  String   @id @default(cuid())
     createdAt           DateTime @default(now())
     provider            String   @default("mango")
     externalId          String                    // id вызова у провайдера
     direction           String   // 'inbound' | 'outbound'
     callerNumber        String                    // E.164
     internalNumber      String?                   // внутренний номер сотрудника
     startedAt           DateTime?
     answeredAt          DateTime?
     finishedAt          DateTime?
     durationSec         Int?
     status              String   // ringing|answered|completed|missed|... (нормализовано из summary)
     recordingId         String?
     recordingPath       String?                   // S3-ключ mp3
     recordingScanStatus String   @default("none") // none|pending|clean|infected|error
     resolvedOrgId       String?
     resolvedUserId      String?
     threadId            String?
     companyId           String?

     resolvedOrg  Organization? @relation(fields: [resolvedOrgId], references: [id])
     resolvedUser User?         @relation(fields: [resolvedUserId], references: [id])
     company      Company?      @relation(fields: [companyId], references: [id])

     @@unique([provider, externalId])            // идемпотентность по id вызова
     @@index([companyId, createdAt])
     @@index([resolvedOrgId, createdAt])
     @@index([callerNumber, createdAt])
   }
   ```

   `provider` + составной unique — задел на будущего оператора; реализуется **только Mango**.

3. **`SyncLog.entity`** (строковое поле) получает два новых значения — `'inbound'`, `'call'` —
   правкой union-типа `SyncLogEntity` в
   [services/oneCSync/log.ts](../../../src/lib/services/oneCSync/log.ts) (миграции БД не требует).
   Исход резолвинга и бэкфилл пишутся туда.

### 2.2. Резолвер (критично для IDOR/C8, общий, чистый)

4. **`resolveInboundSender(prisma, input) → ResolveResult`** — чистая функция в
   `src/lib/services/inbound/resolve.ts`. Вход: `{ channel, chatId?, phone?, email? }` (для звонков —
   `{ phone }`). Выход: `{ matchType: 'exact' | 'unresolved', userId?, orgId?, companyId?, orderId? }`.

   - **Только точное уникальное совпадение** (решение 0.3): `User.telegramChatId` / `User.maxChatId` /
     `User.whatsappPhone` (нормализован в E.164) / `User.email`; для звонков `callerNumber` против
     `User.whatsappPhone` + `Lead.clientContactPhone` (нормализованных).
   - Организация и компания выводятся из членства найденного `User` (`OrganizationUser`/`User.organizationId`).
     **Никогда** не привязывает через границу компаний; `companyId` берётся у организации.
   - `>1` совпадения, либо совпадение только по имени/ИНН, либо привязка через чужую компанию →
     `matchType:'unresolved'` (в очередь). Нечёткого авто-бинда нет нигде.
   - `orderId`/`threadId` проставляются **только** если у найденной организации ровно один открытый
     `OrderThread`; иначе привязку к заявке оставляем ручному шагу A3.
   - Пул unit-тестов: точное попадание по каждому идентификатору; много-совпадение→unresolved;
     кросс-компания→unresolved; имя/ИНН-only→unresolved; нормализация телефона.

   **Ограничение (зафиксировано, не чиним молча).** У `User` нет общего поля телефона (только
   `whatsappPhone`), у `Organization` нет телефона/email. Значит резолвинг звонков по номеру —
   best-effort против существующих телефон-несущих полей; часть звонков осядет в очереди до
   обогащения контактов. Добавление `User.contactPhone`/контакт-таблицы — отдельное решение, **вне
   этого трека** (иначе scope creep).

### 2.3. Слой адаптеров (копия `getOneCAdapter()`; сеть только за адаптером, в тестах — fake)

5. **Входящая почта** — `getInboundEmailAdapter()` в `src/lib/inbound/email/index.ts`,
   env-ключ `INBOUND_EMAIL_ADAPTER=fake|imap`. Port: `fetchNewMessages(cursor) → InboundEmailDto[]`.
   `FakeInboundEmailAdapter` (тест-управляем env-ручками как FakeOneC), `ImapInboundEmailAdapter`
   (реальная реализация под `IMAP_HOST/PORT/USER/PASSWORD/TLS`; боевое подключение — владельцем).
6. **Телефония Mango** — `getMangoAdapter()` в `src/lib/telephony/mango/index.ts`,
   env-ключ `MANGO_ADAPTER=fake|rest`. Port: `verifySign`, `parseEvent`, `fetchRecording(recordingId)`,
   `requestStats(range)`/`fetchStatsResult(key)`. Конфиг только из env: `MANGO_API_KEY`,
   `MANGO_API_SALT`, `MANGO_VPBX_BASE_URL` (дефолт `https://app.mango-office.ru/vpbx/`),
   `MANGO_ALLOWED_IPS` (дефолт `81.88.80.132,81.88.80.133,81.88.82.36`). `FakeMangoAdapter` для тестов.
7. **Wazzup (входящие WhatsApp)** — расширяем существующий
   [lib/whatsapp/aggregator.ts](../../../src/lib/whatsapp/aggregator.ts) функцией разбора входящего
   вебхука + верификацией секрета `WHATSAPP_WEBHOOK_SECRET`. Телеграм/Max — существующие
   `*_WEBHOOK_SECRET`.

### 2.4. Фиче-флаги (opt-in, 4-точечная разводка)

8. `inbound_messaging`, `telephony_mango` — в `FEATURE_FLAGS` + `OPT_IN_FLAGS`. Точки:
   (а) middleware `FEATURE_PREFIXES`: `/manager/inbox`→`inbound_messaging`, `/manager/calls`→
   `telephony_mango`; (б) nav-пункты «Обращения»/«Звонки» с `flag:`; (в) webhook/роут-хендлеры —
   `notFoundIfDisabled(flag)`; вкладки карточки — условный рендер по `isFeatureEnabled`.

### 2.5. PR-A — приём, нормализация, инбокс

9. **A2 (сначала) — ingestion-ядро.** Сервис `ingestInboundMessage(prisma, dto) → Result` в
   `src/lib/services/inbound/ingest.ts`: идемпотентный upsert по `externalId` (повтор не двоит),
   вызов резолвера, запись `InboundMessage` (+`companyId`/`status`), `writeSyncLog({entity:'inbound',
   direction:'inbound', operation:'create'|'skip', ...})`, best-effort уведомление менеджеров
   резолвнутой организации (`notifyManagers`, деградирует молча). **Тело сообщения не исполняется.**
10. **A2 — вложения через антивирус.** Если у dto есть вложение: адаптер тянет байты →
    `getObjectStorage().upload(path, buf, {contentType})` (путь `inbound/{channel}/{externalId}/{name}`)
    → `attachmentPath`+`scanStatus:'pending'` → enqueue `docs.scanDocument` c **новым**
    `{ kind: 'inbound_attachment', id }`. Процессор
    [scan-document.ts](../../../src/worker/processors/scan-document.ts) расширяется ветвью `kind`,
    обновляющей `InboundMessage.scanStatus`. Файл **не отдаётся** до `clean`; `infected` → 410-семантика.
11. **A1 — webhook'и per-channel.** *Расширяем* telegram/max-роуты: не-`/start` апдейт →
    `ingestInboundMessage`. *Новый* `POST /api/integrations/whatsapp/webhook` (Wazzup): секрет →
    `ingestInboundMessage`. Каждый: проверка секрета → 401 при провале; парс защитный; всегда 200;
    `notFoundIfDisabled('inbound_messaging')`. **Почта — не роут:** новая очередь
    `inbound.email.poll` + плановая задача в `SYNC_SCHEDULES` + процессор `poll-inbound-email.ts`
    (адаптер `fetchNewMessages` → `ingestInboundMessage` в цикле, курсор в `SyncState`).
12. **A3 — единый инбокс.** Экран `/manager/inbox` (Server Component, `requireManager` +
    `notFoundIfDisabled`): все каналы в одном окне, фильтр по организации/заявке, company-scoped
    (как `getOrganizationCard`). Сервис `listInbox(prisma, session, filters)` — узкие селекты,
    C8-скоуп. Очередь «нераспознанные» с действием **«привязать к организации/заявке»**
    (server-action `bindInboundMessageAction` → устанавливает `resolvedOrgId`/`threadId`/`companyId`,
    `status:'bound'`, аудит). **Ответ** — server-action `replyInboundAction`: реюз транспорта по
    каналу (tg/max/wa/email), при наличии `threadId` дополнительно пишет обычный `Message` (автор —
    сотрудник) и `notifyOrgUsers('manager_replied')`; audit + `SyncLog(direction:'out')`.
    Плюс вкладка **«Обращения»** в CRM-карточке (данные добавляются в `getOrganizationCard`).
13. **Видимость инбокса — company-scoped, менеджер + руководитель**; admin — через `/admin`-зеркало
    (вне объёма v1). Не пускаем клиентские роли (partner/organization) — это внутренний контур.

### 2.6. PR-B — телефония Mango

14. **B1 — приём событий.** `POST /api/integrations/mango/webhook` (`notFoundIfDisabled(
    'telephony_mango')`): (а) IP-allowlist из `MANGO_ALLOWED_IPS`; (б) подпись
    `sha256(api_key + json + api_salt)` через адаптер `verifySign`; провал любого → 401. Парсинг
    `parseEvent` за адаптером: `call` / `summary` (с `call_direction`) / `recording`
    (`recording_state=Completed` → `recording_id`). Всегда 200.
15. **B2 — журнал звонков.** Сервис `ingestCallEvent(prisma, event) → Result`: идемпотентный upsert
    `Call` по `@@unique([provider, externalId])`; резолвинг `callerNumber` (решение 4); привязка к
    орг/контакту (+заявке, если определимо); `writeSyncLog({entity:'call'})`. Разные типы событий
    того же вызова мёржатся в одну строку (summary дополняет длительность/статус).
16. **B3 — записи.** По `recording(Completed)`: адаптер `fetchRecording(recording_id)` (mp3 или
    ссылка с `expires`) → S3 (`calls/{externalId}/recording.mp3`) → `recordingPath`+
    `recordingScanStatus:'pending'` → enqueue `docs.scanDocument` c `{ kind:'call_recording', id }`.
    **Звонок без записи — валидный, непадающий путь** (услуга записи у Mango платная).
17. **B4 — вкладка «Звонки»** в CRM-карточке: история звонков с абонентом; прослушивание/скачивание
    записи через presigned-URL (600 с, 302), только при `recordingScanStatus:'clean'`. Данные — в
    `getOrganizationCard`, гард `requireManagerForOrg`.
18. **B5 — бэкфилл истории.** Двухшаговый `/vpbx/stats` (`requestStats` → поллинг `fetchStatsResult`)
    через новую очередь `telephony.mango.backfill` + плановую задачу `SYNC_SCHEDULES` + процессор;
    каждый вызов идемпотентен против живых событий B1 (тот же `ingestCallEvent` по unique-ключу),
    курсор/окно в `SyncState`, лог в `SyncLog`.
19. **Клик-ту-колл** (исходящий `callback`) — **вне объёма**, опциональный отдельный шаг.

## 3. Инварианты приёмки

- Входящие из Telegram/Max/WhatsApp(агрегатор)/email принимаются, нормализуются, привязываются к
  организации/заявке; нераспознанные — в очередь; повторный webhook/поллинг **не двоит** (тест
  идемпотентности по `externalId`). Все внешние вызовы — за адаптером, в тестах замоканы.
- Единый инбокс показывает входящие всех каналов в одном окне, company-scoped; **ответ уходит через
  существующий исходящий транспорт** (реюз, не дубль); при наличии треда зеркалится в `Message`.
- События Mango (call/summary/recording) принимаются только при валидной подписи **и** IP-allowlist
  (иначе 401, без обработки); звонок логируется и привязывается; запись сохраняется в S3 и доступна
  из карточки только `clean`; **звонок без записи не падает**.
- История Mango добирается через `/vpbx/stats` идемпотентно (повторный бэкфилл дублей не создаёт).
- **IDOR/C8-регресс:** менеджер компании A не видит входящие/звонки компании B; резолвер не
  привязывает через границу компаний; клиентские роли не имеют доступа к инбоксу (тесты на каждый).
- **Содержимое входящих не исполняется как команды** (тело — только данные).
- Секреты/ключи — только из env; флаги `inbound_messaging`, `telephony_mango` гейтят все 4 точки.
- Новые процессоры покрыты integration-тестами (worker guardrail зелёный).
- `typecheck`, `lint`, `test`, `gate` — зелёные; миграции обратимы; `prisma migrate status` — чисто.

## 4. Вне объёма (follow-up)

- Боевое подключение: webhook-URL + токены Telegram/Max, API-ключ Wazzup, inbound-email провайдер/
  IMAP-креды, `api_key`/`api_salt` Mango и впуск IP Mango — настраиваются владельцем после сборки на моках.
- Реальные реализации адаптеров сверх минимально нужного шва: точные схемы полей Mango/Wazzup/IMAP
  уточняются по докам провайдеров при боевом подключении; в v1 парсинг защитный, всё замокано.
- Клик-ту-колл Mango (`callback`).
- Промоут входящих вложений в официальные `Document` (XOR order/company + counterparty).
- Инбокс в admin-зеркале (`/admin`).
- Двусторонняя сшивка **каждого** канала в `OrderThread` (полная messenger-склейка) — v1 хранит
  входящие в `InboundMessage` и зеркалит только ответы при существующем треде.
- Обогащение контактов (`User.contactPhone`/контакт-таблица) для лучшего резолвинга звонков по номеру.
