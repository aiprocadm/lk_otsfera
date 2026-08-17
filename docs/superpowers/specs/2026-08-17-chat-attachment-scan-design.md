# Спека: антивирус для вложений клиентского чата

**Дата:** 2026-08-17 · **Источник объёма:** запись «Вне объёма» в
`docs/tz/AUDIT.md` (дыра найдена сверкой 14.08, PR #369), взята по явному
выбору заказчика 17.08.2026. Требования `У-N` под неё нет — это закрытие
записанной дыры безопасности.

## 1. Проблема

Вложения чата клиентских кабинетов (модель `Message`, вкладка «Сообщения» у
партнёра/организации/менеджера/админа) **не проверяются антивирусом**: у
строки `Message` нет `scanStatus`, скан не ставится в очередь, скачивание не
гейтится. Направление опасное: файл грузит **клиент** (партнёр/организация),
открывает **сотрудник** (менеджер/админ). Все остальные каналы — документы,
входящая почта, заявки клиентов, записи звонков, служебный чат — проверяются
общим процессором `docs.scanDocument`. Отсрочка «до v1.1» объявлена в шапке
`chat/attachments.ts` осознанно; v1.1 настал.

## 2. Решение — зеркало служебного чата

Служебный чат (`StaffMessage`) — готовый образец всей цепочки: колонка-строка
`scanStatus` (`none|pending|clean|infected|error`), постановка скана при
отправке сообщения, kind в общем процессоре, гейт в сервисе выдачи ссылки,
коды `409 not_ready` / `410 infected` в роуте, бейджи в UI, ветка в часовом
backfill-sweep. Повторяем один в один, kind — `chat_attachment`.

### 2.1 Миграция (SQL руками, применение `migrate deploy`)

- `ALTER TABLE "Message" ADD COLUMN "scanStatus" TEXT NOT NULL DEFAULT 'none';`
  — **`'none'`, не `'pending'`** (как StaffMessage/InboundMessage): default
  `'pending'` пометил бы все старые сообщения без вложений и завалил sweep.
- Бэкфилл настоящих вложений: `UPDATE ... SET "scanStatus"='pending' WHERE
  "attachmentPath" LIKE 'chat/%'` — непроверенные файлы становятся
  «проверяется» и в течение часа проходят sweep. Legacy-строки бэкфилла
  `Comment → Message` (пути не `chat/…`) остаются `'none'`: их скачивание и
  так отрезано префикс-гардом, а их файлы сканируются в своём канале
  (`Document`).
- `CREATE INDEX "Message_scanStatus_idx"` + `@@index([scanStatus])` в схеме —
  прецедент Document/LeadAttachment («speed up backfill query»); без него
  часовой sweep сканирует таблицу сообщений целиком (урок PR #377).
- CONCURRENTLY нельзя (Prisma гонит миграцию в транзакции) — как в
  `20260815120000_comment_order_index`.

### 2.2 Постановка скана — `chat/messages.ts` (`sendMessage`)

`message.create({..., scanStatus: attachmentPath ? 'pending' : 'none'})` +
best-effort enqueue `docs.scanDocument` c `{kind:'chat_attachment', id}`
(try/catch + `log.warn`, §3 degrade gracefully) — копия
`staffChat/messages.ts:111-121`.

### 2.3 Процессор и sweep — новый kind, БЕЗ нового процессора

- `ScanDocumentTarget` + `'chat_attachment'` (`lib/jobs/types.ts`).
- `scan-document.ts`: ветка в `loadTarget` (читать `message.attachmentPath`)
  и в `persistResult` (писать только `scanStatus`, как staff). Зеркальные
  security-ветки (download-фейл/сканер недоступен → re-throw, не persist) —
  общие, не трогаются.
- `scan/backfill.ts`: ключ `chatAttachments` в `BackfillResult` + ветка
  `message` с `where {scanStatus:'pending', attachmentPath:{not:null}}`.
- Скан-инфраструктура **вне флага `chat`** — как у staff: флаг гейтит только
  HTTP-поверхность; иначе выключение флага заморозило бы вложения в
  `pending` навсегда.

### 2.4 Гейт выдачи ссылки — `chat/attachments.ts`

`getChatAttachmentSignedUrl`: селектить `scanStatus`; после префикс-гарда —
`infected → 'infected'`, `scanStatus !== 'clean'` → `'not_ready'` (покрывает
pending/error и гипотетический none-с-вложением), только `clean` → presigned
URL. Union результата расширяется двумя кодами; русские тексты в
`errors/messages.ts` уже есть. Шапки-комментарии файла и роута («No ClamAV
scan in v1») переписываются — иначе они станут враньём.

### 2.5 Роут — `api/messages/attachment` GET

Маппинг как у staff-роута: `not_ready → 409`, `infected → 410` (410 Gone для
карантина — канон §10 CLAUDE.md), остальное без изменений.

### 2.6 UI — бейджи вместо мёртвой ссылки

`listMessages` (и лента сделки менеджера, если она рисует ссылку) отдаёт
`scanStatus` в VM; `chat-thread-view` / `order-thread-inbox`: `clean` →
ссылка «Вложение», `infected` → пометка «Файл заражён», иначе — «Файл
проверяется» (образец `staff-thread-view.tsx:35-58`). Без этого ссылка
выглядела бы рабочей и падала 409-й — молчаливый дефект §15.

## 3. Что НЕ входит

- Колонки `attachmentName`/`attachmentMime` у Message (паритет
  `download: attachmentName` со staff) — имя живёт в хвосте S3-ключа,
  отдельная задача.
- Общий enum ScanStatus в схеме — его нет ни у одной модели, не заводим.
- Карантин в списках (`INFECTED_HIDDEN_WHERE` на Message) — списки отдают
  только `hasAttachment`, сырой путь не утекает; бейджа достаточно.
- Пересканирование legacy-строк бэкфилла Comment→Message (см. §2.1).

## 4. Тестовая стратегия

- **Схема:** `schema.chat.test.ts` — у Message есть `scanStatus` с дефолтом.
- **Сервисы:** `services.chat.messages.unit` — pending при вложении, none
  без, enqueue kind `chat_attachment`, сбой enqueue не роняет отправку;
  `services.chat.attachments.{unit,integration}` — гейт not_ready/infected/
  clean.
- **Процессор:** `worker.scan-document.test.ts` — мок `db.message`, ветки
  clean/infected/не тот kind (по образцу staff-кейсов).
- **Sweep:** `services.scan.backfill.test.ts` — новая форма результата
  (`chatAttachments`) + ветка Message (правятся 6+ ассертов формы).
- **Роут:** `api.messages.attachment.test.ts` — 409/410.
- **UI:** тесты чат-компонентов — три состояния вложения.
- Migrate deploy на локальном Postgres + `prisma migrate status` без дрейфа;
  полный `test:coverage` (гейт 100 %).

## 5. Риски

- Существующие вложения на проде до прохода sweep (≤1 час) будут отвечать
  «проверяется» — осознанная плата за честность: раньше они не проверялись
  вовсе. Sweep можно ускорить перезапуском воркера.
- `CLAMAV_HOST` не задан → процессор помечает `clean` с warn-логом
  (существующее поведение всех каналов, не меняем).
- Тест формы `BackfillResult` ломается добавлением ключа — правится в том же
  PR (это и есть страж полноты sweep).
