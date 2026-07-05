# PR-A — Входящие сообщения (омниканальный инбокс) — CLOSE-OUT

**Дата:** 2026-07-05
**План:** [2026-07-05-omnichannel-pr-a-inbound.md](2026-07-05-omnichannel-pr-a-inbound.md)
**Спека:** [2026-07-05-omnichannel-inbound-telephony-design.md](../specs/2026-07-05-omnichannel-inbound-telephony-design.md)
**Статус:** ОТГРУЖЕНО. Реализация методом subagent-driven-development (свежий сабагент на задачу + двухстадийное adversarial-ревью между задачами).
**Ветка:** `claude/trusting-ramanujan-985001` (не запушена — по договорённости стоп на ревью владельца).

## Что отгружено (13 коммитов, `a972ebd` → `08384df`)

| Задача | Коммит | Суть |
|---|---|---|
| 0 — флаг `inbound_messaging` | `a972ebd` | opt-in флаг, 4-точечная разводка (флаг+middleware+nav) |
| 1 — модель `InboundMessage` + миграция | `f9b5386` | аддитивная миграция `20260705104237_inbound_message` |
| 2 — резолвер отправителя | `119fe11` | `resolveInboundSender` exact-match, C8/IDOR-safe |
| 3 — `SyncLogEntity += inbound` | `625280b` | строковое значение, без миграции БД |
| 4 — `ingestInboundMessage` | `6dab335` | идемпотентный приём (findUnique + P2002-гонка) |
| 5 — антивирус `inbound_attachment` | `1d0bc79` | ветвь `kind` в существующем `docs.scanDocument` |
| 5b — продюсер скана + backfill | `e92da22` | enqueue при вложении + подметание `runBackfill` |
| 6 — webhook Telegram/Max | `3d55f46` | приём не-`/start` сообщений |
| 7 — webhook Wazzup (WhatsApp) | `457877b` | `parseWazzupInbound` + приёмник |
| 8 — IMAP-адаптер + воркер-поллинг | `017ee06` | `getInboundEmailAdapter` (fake/imap) + плановая задача |
| 9 — `replyToInbound` | `c0d57d7` | реюз исходящих транспортов |
| 10 — server-actions bind/reply | `98b378d` | company-scoped привязка/ответ |
| 11a — `listInbox` + IDOR | `e6c5f20` | company-scoped выборка + IDOR-регресс |
| 11b — экран `/manager/inbox` | `77a0e8e` | список + формы привязки/ответа |
| 12 — вкладка «Обращения» карточки | `08384df` | read-only история входящих в CRM-карточке |

## Дефекты, пойманные adversarial-ревью и исправленные до мержа задачи

Ревью читали дифф (не отчёт сабагента) и находили реальные баги:
1. **Резолвер email — case-sensitivity** (Task 2): резолвер лоуэркейзил email, но БД сравнивает email регистрозависимо везде → тихий промах известных контактов. Фикс: `mode:'insensitive'`.
2. **Идемпотентность — гонка** (Task 4): check-then-create бросал `P2002` при конкурентной доставке вебхука. Фикс: try/catch P2002 → re-read → deduped; + тест гонки.
3. **Регресс bare-`/start`** (Task 6): строгий `/^\/start\s+(\S+)/` пускал голый `/start` (кнопка Start) в инбокс как шум-строку. Фикс: гард `!/^\/start\b/`; + skip при отсутствии messageId.
4. **Wazzup — поддельный телефон** (Task 7): тип-гард не проверял тип `chatId` → object/array давал ложный `+799…`. Фикс: `typeof string|number`.
5. **Cross-company bind IDOR** (Task 10, critical): в teamMode OFF `bindInboundMessageAction` использовал `managedOrgIds` без company-пола → менеджер мог привязать входящее к орг чужой компании. Фикс: `org.companyId === session.companyId` в обоих режимах; + fail-before-fix регресс-тест.

Каждый фикс закреплён тестом, воспроизводящим баг.

## Пробел плана, закрытый по ходу
- **Task 5b** (не было в исходном плане): Task 4 ставил `scanStatus:'pending'` при вложении, но ничего не enqueue-ило скан, и `runBackfill` не подметал `InboundMessage` → вложение зависало бы в `pending` вечно. Закрыт двойной фикс (продюсер в ingest + backfill-проход).

## Инцидент и восстановление (Task 8)
Два сабагента пересеклись на Task 8 (один заспавнил внука вопреки no-spawn, другой — мой повтор), плюс один запустил `git commit` в фоне и «запарковался». Распутано контроллером: `TaskStop` лишнего → проверка целостности рабочего дерева → **сам** проверил застейдженную работу (typecheck + 29 тестов + guardrail + чистый дифф 11 файлов) → закоммитил под контролем (`017ee06`). Урок записан в память `subagent-hard-rules` (медленный pre-commit хук на широко-импортируемых файлах провоцирует background-commit → park; перед повтором задачи убедиться, что прежний агент мёртв).

## Финальный гейт
- `npm run typecheck` — ✅ чисто.
- `npm run lint` — ✅ «No ESLint warnings or errors».
- `npm run test:unit` — ✅ 3907 passed (3 skipped).
- `npm run test:integration` — ✅ зелёный после фикса тест-env (см. ниже).
- `npx prisma migrate status` — ✅ «Database schema is up to date!» (46 миграций).

**Тест-env заметка:** первый прогон интеграции упал на **пред-существующем** тесте `services.chat.attachments.integration.test.ts` (не тронут PR-A) — из-за неверного значения в моём локальном `.env`: `DOCUMENT_MAX_FILE_SIZE_MB=200` вместо **`=20`**, которого ждёт тест (21МБ → too_large). Исправлено в `.env` (gitignored, не часть диффа). Зафиксировано в памяти `local-test-environment` (там это уже было — я не сверился с ней при синтезе .env).

## Deferred / follow-up (вне объёма PR-A)
- **Ответ по email** — `replyToInbound` для email возвращает `{ ok:false }` → server-action маппит в `email_unsupported` (UI показывает явную заметку). Причина: исходящий email-слой только шаблонный (нет raw-send). Проводка raw-email — при боевом подключении.
- **Провайдерная выкачка вложений в вебхуках** — процессор скана поддерживает `inbound_attachment`, ingest enqueue-ит при наличии `attachmentPath`, но текущие вебхуки принимают только текст (не тянут байты вложений из провайдера в S3). Полная сшивка вложений — follow-up.
- **Cross-company assignment (upstream)** — bind-дыра закрыта defensively, но корневая причина (admin-флоу назначает менеджера на орг без company-констрейнта) — отдельная задача (флаг `task_7e739093`).
- **Live-render проверка экрана** `/manager/inbox` — отложена на ручной Playwright-проход (требует auth-сессию; typecheck+lint зелёные, паттерны существующие).
- **admin-инбокс** (`/admin`-зеркало), **полная messenger-сшивка каждого канала в `OrderThread`** — по спеке §4, не в v1.

## Далее
PR-B — телефония Mango (11 задач, план [2026-07-05-omnichannel-pr-b-telephony.md](2026-07-05-omnichannel-pr-b-telephony.md)). Резолвер, слой адаптеров, антивирус-`kind` и точки CRM-карточки переиспользуются из PR-A.
