# PR-B — Телефония Mango (Mango Office VPBX) — CLOSE-OUT

**Дата:** 2026-07-05
**План:** [2026-07-05-omnichannel-pr-b-telephony.md](2026-07-05-omnichannel-pr-b-telephony.md)
**Спека:** [2026-07-05-omnichannel-inbound-telephony-design.md](../specs/2026-07-05-omnichannel-inbound-telephony-design.md)
**Статус:** ОТГРУЖЕНО. Метод — subagent-driven-development (свежий сабагент на задачу + двухстадийное adversarial-ревью). Поверх PR-A (входящие), с которым делит резолвер, слой адаптеров, антивирус-`kind` и точки CRM-карточки.
**Ветка:** `claude/trusting-ramanujan-985001` (не запушена — стоп на ревью владельца).

## Что отгружено (9 коммитов, `c6ed9bd` → `7734258`)

| Задача | Коммит | Суть |
|---|---|---|
| 0 — флаг + модель `Call` + миграция | `c6ed9bd` | `telephony_mango` (opt-in) + `Call` (@@unique provider,externalId) + `SyncLogEntity += call` |
| 1–3 — примитивы Mango | `fd71107` | подпись `sha256(key+json+salt)` (timing-safe) + IP-allowlist + защитный парсер событий |
| 4 — адаптер `getMangoAdapter` | `3dd1d94` | env-keyed fake/rest; rest — boarding-заглушка |
| 5 — резолвер + журнал звонков | `1e649c1` | `resolveCaller` (RU 8→7, C8/IDOR) + идемпотентный `ingestCallEvent` (upsert) |
| 6 — webhook Mango | `b3c1897` | IP-allowlist **И** подпись (оба обязательны → 401); enqueue записи |
| 7 — запись → S3 через антивирус | `84e6ed6` | `mango-recording` воркер + ветвь `call_recording` скана; звонок без записи не падает |
| 8 — бэкфилл `/vpbx/stats` | `f57f1c8` | двухшаговый идемпотентный воркер + плановая задача |
| 9a — `listCalls` + скачивание записи | `da37ae2` | company-scoped выборка + presigned-роут (clean-gate, infected→410) + IDOR-регресс |
| 9b — экран `/manager/calls` + вкладка «Звонки» | `7734258` | список звонков + read-only история в карточке |

## Дефекты и рекомендации из ревью — исправлены

1. **RU-нормализация телефона (Task 5):** `normalizePhone` не делает 8→7, поэтому звонки в национальном формате `8XXX…` не резолвились к контактам `+7XXX…`. Добавлен `canonicalizeRuPhone` **локально в телефонии** (не трогая общий нормализатор, чтобы не задеть WhatsApp).
2. **Гонка порядка событий (Task 5):** out-of-order `call`-событие после `summary` затирало авторитетное направление. Ветвь `call`-события в upsert сделана `update: {}` (не клоббрит); + регресс-тест на out-of-order.
3. **§10 infected→410 (Task 9a):** роут скачивания записи возвращал 404 для `infected`, а CLAUDE.md §10 требует **410 Gone** («это разные сигналы») — как все document-роуты. Исправлено: `infected`→410, прочие not-clean→404.
4. **Подтверждено ревью:** подпись криптографически корректна без обхода (length-guard перед timing-safe compare); IP-allowlist — defense-in-depth, подпись — реальный неподделываемый гейт; XFF доверяем только за прокси (задокументировано в роуте); резолвер звонков не привязывает через границу компаний; presigned-путь S3 не утекает в JSON.

## Инцидент сессии и восстановление (во время фикса Task 9a)
Сессия прервалась при amend-коммите фикса Task 9a. При рестарте Docker Desktop упал, унеся Postgres-контейнер, а `docker compose up` из worktree создал **новый пустой** том `pgdata` (проектное имя = имя каталога, отличается от старого `promtech-cabinet`). Восстановление контроллером: чистый перезапуск Docker (движок headless поднялся со второго захода) → `prisma migrate deploy` (47 миграций на свежую БД) → `prisma:seed` (Redis поднят, не завис) → проверка 3 тестов Task 9a (19/19) → amend-коммит фикса (`da37ae2`). Фикс был unit-проверен ещё до падения БД (логика 410 в unit-тесте).

## Финальный гейт
- `npm run typecheck` — ✅ чисто.
- `npm run lint` — ✅ «No ESLint warnings or errors».
- `npm run test:unit` — ✅ (полный unit-слой).
- `npm run test:integration` — ✅ (полный integration-слой на восстановленной БД).
- `npx prisma migrate status` — ✅ «Database schema is up to date!» (47 миграций).
- **`.env` тест-окружения:** `DOCUMENT_MAX_FILE_SIZE_MB=20` (gitignored; см. память `local-test-environment`).

## Deferred / follow-up (вне объёма PR-B)
- **Реальный REST-адаптер Mango** — `RestMangoAdapter` сейчас boarding-заглушка (бросает «not wired»); реальные подписанные POST-запросы на `MANGO_VPBX_BASE_URL` + `api_key`/`api_salt` — при боевом подключении.
- **Клик-ту-колл** (исходящий Mango `callback`) — опциональный отдельный шаг, вне объёма.
- **XFF-доверие** — IP-allowlist читает первый хоп `x-forwarded-for`; доверять только за прокси, который его выставляет/стирает. Подпись — основной гейт (задокументировано в роуте).
- **Скачивание записи нераспознанного звонка** — намеренно запрещено (companyId=null → 404): запись телефонного разговора чувствительна, кросс-тенант/нераспознанное не отдаём.
- **Точные схемы полей Mango** (call/summary/recording, `/vpbx/stats`) — уточняются по докам провайдера при подключении; в v1 парсинг защитный, всё на моках.

## Итог омниканала (PR-A + PR-B)
Единый инбокс входящих (Telegram/Max/Wazzup/email) и журнал звонков Mango отгружены поверх зрелых слоёв, под opt-in флагами `inbound_messaging` / `telephony_mango`, с company-scope/IDOR-инвариантами, антивирус-конвейером для вложений и записей, и полным отсутствием сетевых вызовов в тестах. Оба PR — на ветке, ждут ревью и боевого подключения владельцем.
