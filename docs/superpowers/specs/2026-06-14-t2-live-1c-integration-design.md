# T2 — Живая 1С API-интеграция: дизайн

**Дата:** 2026-06-14
**Трек:** T2 из [launch-readiness-roadmap](2026-06-13-launch-readiness-roadmap.md) (🔴 launch-критичный). Зависит: T1 (контракт+writers+translate готовы).
**Метод подготовки:** 4 параллельных code-разведки (file:line). Все находки подтверждены в текущем коде, не из памяти.

## Цель

Перевести 1С-синк с `fake` на живой `rest`-адаптер. Включение само по себе — это env (`ONE_C_ADAPTER=rest` + URL/token + shadow-rehearsal), **кода не требует**. Но три «мины» делают live-адаптер неполным/опасным, и есть латентный DOC-03. T2 = довести REST-адаптер до contract-completeness, которой Excel-адаптер уже достиг в T1, + пагинация + DOC-03.

Принцип: **REST-адаптер должен пройти ровно тот же контракт+перевод+валидацию, что и file-адаптер** (T1 сделал file эталоном; REST отстал).

---

## Готовый задел (не трогаем, опираемся)
- `getOneCAdapter()` factory ([oneCSync/index.ts:7](../../../src/lib/services/oneCSync/index.ts)) — fake/rest switch; REST требует `ONE_C_API_URL`+`ONE_C_API_TOKEN`.
- REST-адаптер ([adapter-rest.ts](../../../src/lib/services/oneCSync/adapter-rest.ts)) — все pull + pushLead, retry/timeout, envelope-unwrap.
- Shadow-mode (`ONE_C_MODE=shadow`, [config.ts](../../../src/lib/services/oneCSync/config.ts)) — pull+validate без записи; write-gate в writers.
- Контракт DTO + zod ([schemas.ts](../../../src/lib/services/oneCSync/schemas.ts)) + writers (`upsert*Record`) + `translate.ts` — общие; file-адаптер уже conformant.
- Mock-1С REST-сервер (`mock-1c/`) с конфигурируемой пагинацией (`MOCK1C_PAGE_SIZE`) — стенд для проверки Q6.

---

## Landmine 1 — Q6: пагинация (P0 для live, структурный код)

### Подтверждённая причина
`unwrapEnvelope` ([rest-wire.ts:28](../../../src/lib/services/oneCSync/rest-wire.ts)) берёт `items` и **молча выбрасывает `nextCursor`**. Адаптерный контракт `Promise<Dto[]>` ([adapter.ts:11](../../../src/lib/services/oneCSync/adapter.ts)) — без признака «есть ещё». Процессоры зовут `pullX(cursor)` один раз ([sync-orders.ts:27] и соседи). `advanceCursor` ставит watermark по max первой страницы → следующий запуск стартует уже ЗА невыбранными записями → **вечный тихий недоимпорт**; `getSyncLag` это не ловит (лаг считается по курсору).

### Решение (engineering, без решения владельца)
Реализовать постраничный pull **внутри адаптера** (SRP: пагинация — забота адаптера, процессоры не меняются):
- `getArray()` ([adapter-rest.ts:22](../../../src/lib/services/oneCSync/adapter-rest.ts)) — цикл: запрашивать, пока сервер отдаёт `nextCursor`; аккумулировать items; передавать `nextCursor` в `buildUrl` следующей итерации.
- `unwrapEnvelope` → вернуть `{ items, nextCursor? }` (не терять токен); `buildUrl` ([rest-wire.ts]) принимает опц. `pageCursor` → query-param.
- Защита от бесконечного цикла (cap итераций + log) и от runaway (cap записей за прогон, log при упоре — «no silent caps»).
- **Курсор не трогаем структурно** (по `since` остаётся): пагинация исчерпывается ВНУТРИ одного pull, поэтому `advanceCursor(maxUpdatedAt по ВСЕМ страницам)` корректен. Survives-restart-mid-pagination (опц. B со стейтом в `SyncState`) — **non-goal T2** (исчерпываем за один прогон; при падении — повтор с того же `since`, overlap спасает).

### Открытый вопрос (Q6-Q) — снят владельцем
«Пагинирует ли боевая 1С» — раньше внешний. Решение владельца: **контракт наш**. Значит реализуем пагинацию по нашему формату `{items,nextCursor}` и mock это уже умеет; 1С обязана следовать. Реализуем безусловно (надёжнее при неизвестном объёме).

---

## Landmine 2 — Q10: перевод справочников в REST (P0 для live, код)

### Подтверждённая причина
`translate.ts` (RU→enum) зовёт **только** file-адаптер ([adapter-file.ts:73]). REST ([adapter-rest.ts:34,40,43]) кастует raw JSON в DTO **вербатим** → zod ждёт внутренние коды (`paid`/`in_progress`). Если 1С шлёт «Оплачено»/«Выполнен» → zod-карантин на каждой записи → синк отдаёт 0 строк.

### Решение
REST-адаптер должен переводить статусы **до** сборки DTO, как file-адаптер. Чистое место — слой парсинга в REST (`rest-wire.ts` map-функция order/payment, зовущая `translateFinancialStatus/ExecutionStatus`). Сохранить fallback-семантику file-адаптера где применимо (execution по умолчанию). Невалидные после перевода → тот же `BatchSummary.invalids` карантин (паритет отчётности).

### Открытый вопрос (Q10-Q) — снят владельцем
«Шлёт 1С коды или русский» — контракт наш → **принимаем русский и переводим** (1С нативно говорит русскими статусами; мандат «шли английские» хрупок). Реализуем перевод в REST безусловно; добавить тест с `financialStatus:'Оплачено'`.

---

## Landmine 3 — DOC-03: download 1С-документов (P1, код + решение)

### Подтверждённая причина
`upsertDocumentRecord` пишет `path: input.downloadUrl` (внешний URL 1С) ([writers.ts:135]). Все download-роуты зовут `supabaseAdmin.storage.createSignedUrl(doc.path)` — ждут storage-ключ → для 1С-дока **502**. Различители есть: `generatedBy='system'` + `externalId!=null`.

### Решение — Вариант A (fetch-and-store), рекомендуется
На синке скачать файл из 1С → загрузить в Supabase (`documents` bucket) → в `path` положить storage-ключ (как uploaded-доки). Тогда download-роуты **не меняются**, файл **сканируется** ClamAV, и соблюдается **CLAUDE.md §10** («никогда не отдавай файл напрямую через приложение» / только signed URL). Вариант B (302 на внешний URL) — проще, но нарушает §10 (голый внешний URL, без скана, игнор TTL) → **отвергнут** как противоречащий хард-правилу проекта.

Реализация: helper `fetch1CDocument(url)` (с timeout/retry как остальной REST), в `upsertDocumentRecord` (live-mode) — fetch→upload→`path=storageKey`; enqueue `docs.scanDocument` (как обычный upload, §10); graceful: 1С недоступна → skip с reason + видимый отчёт (как карантин T1), не падать.

### Открытый вопрос (DOC-03-Q)
Скан 1С-документов: ставить `scanStatus='pending'`+enqueue scan (как upload) — да, для единообразия §10. Объём/латентность fetch на синке: при больших файлах синк-джоба тормозит — приемлемо для старта (ретраи BullMQ); при проблемах — отдельная очередь `docs.fetchExternal`. **Дефолт:** inline fetch в writer + enqueue scan; вынос в очередь — follow-up если профиль покажет.

---

## Landmine 4 — Q5: ключ партнёра (решение, возможно миграция)

### Подтверждённая причина
Партнёр резолвится по `Partner.slug` в обе стороны; `PARTNER_KEY_FIELD='partnerSlug'` ([rest-wire.ts:57]). Колонки `Partner.externalId` нет.

### Решение — Вариант A (slug-ключ), рекомендуется
Контракт наш → **оставляем `slug` ключом партнёра** (inbound `partnerExternalId`-поле трактуется как slug; outbound `partnerSlug`). **Миграции не нужно**, flip — выравнивание имён полей. Вариант B (GUID `Partner.externalId` + миграция) — только если 1С физически не может слать slug; откладываем до фактической необходимости. Зафиксировать в контракте `docs/integrations/1c-contract.md`.

---

## Тестовая стратегия

| Мина | Слой | Тест |
|---|---|---|
| Q6 | unit (adapter-rest) | мок `fetch` отдаёт 2 страницы с `nextCursor` → адаптер аккумулирует обе; одна страница без токена → одна; cap-guard срабатывает. |
| Q6 | e2e-ish | через `mock-1c` с `MOCK1C_PAGE_SIZE>0` (ручной/operator) — полный счёт, не первая страница. |
| Q10 | unit (rest map) | `financialStatus:'Оплачено'`→`paid`; `executionStatus:'Выполнен'`→`completed`; мусор→карантин (`invalids`). |
| DOC-03 | unit/integration | writer с 1С-доком: fetch замокан → `path`=storage-ключ (не URL) + enqueue scan; fetch-fail → skip+reason, не падает. download-роут на таком доке → 200 signed URL (не 502). |
| Q5 | unit | push/buildLeadBody шлёт `partnerSlug`; inbound резолв по slug (паритет с текущим). |

Гейты: typecheck/lint/`test:unit` локально; integration — WSL live-PG ([[project-wsl-live-pg-verification]]); `build`. Shadow-rehearsal через mock-1c перед live (operator).

## Порядок реализации (subagent-driven, §8)
1. **Q10** перевод в REST (изолированно, unit) — без него live = 0 строк.
2. **Q6** пагинация в adapter-rest (структурно, unit + mock) — без неё live = недоимпорт.
3. **DOC-03** fetch-and-store + enqueue scan (writer + download-роут паритет).
4. **Q5** зафиксировать slug-контракт (config/doc; миграции нет).
5. Контракт-док + `.env.example` обновить; shadow→live runbook-абзац.

## Операционка (вне кода, перед боевым включением)
- Shadow-rehearsal: `ONE_C_ADAPTER=rest ONE_C_MODE=shadow` против реальной 1С → инспект `/admin/sync` (operation='check'), 0 записей, карантин/недоимпорт видны.
- Включение: `ONE_C_MODE=live`.
- A1-встречи нет (контракт наш) — внешнего блокера T2 не осталось.
