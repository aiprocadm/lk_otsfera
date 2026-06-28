# T2 — Живая 1С API-интеграция: close-out (DONE, код)

**Дата:** 2026-06-14
**Ветка:** `claude/t1-f6-leader-axes`
**Спека:** [../specs/2026-06-14-t2-live-1c-integration-design.md](../specs/2026-06-14-t2-live-1c-integration-design.md)

REST-адаптер 1С доведён до contract-completeness (паритет с Excel-адаптером, который T1 сделал эталоном) + закрыты 3 «мины» и латентный DOC-03. Каждая находка предварительно подтверждена в коде (4 параллельных Explore), всё по TDD. Включение в прод теперь = env + shadow-rehearsal (кода не требует).

| Мина | Коммит | Суть фикса |
|---|---|---|
| Q10 перевод | `dfd65b2` | REST не звал `translate.ts` → русские статусы шли в карантин (0 строк). `normalizeOrderRecord` (rest-wire) переводит RU→enum до zod, применяется в `pullOrders`; уже-внутренние/неизвестные проходят (неизвестные → карантин). |
| Q6 пагинация | `7a20bb3` | `unwrapEnvelope` терял `nextCursor` → импорт только 1-й страницы + курсор уезжал. `getArray` теперь цикл по `nextCursor` (через `?cursor=`, `parseEnvelope`, MAX_PAGES-гард). Mock-1С апгрейжен честно отдавать страницы; live-mock контракт-тест доказывает полный счёт. |
| DOC-03 download | `95bb1a1` | 1С-документы писали внешний URL в `Document.path` → download 502. `fetchAndStore1CDocument` качает файл в Supabase, writer пишет storage-ключ + enqueue скан (Redis-gated). Вариант A (fetch-store), не B (302) — §10. Fetch-fail → skip `document_fetch_failed`. |
| Q5 ключ партнёра | (доки) | Решение: `Partner.slug` остаётся ключом (вариант A, **без миграции**). Уже реализовано + тест; зафиксировано в `docs/integrations/1c-contract.md`. |

## Решения владельца (делегированы агенту, «контракт наш»)
- Q6: реализуем пагинацию по нашему формату `{items,nextCursor}` (надёжнее при неизвестном объёме).
- Q10: принимаем русские статусы и переводим в кабинете (1С нативно русскоязычна).
- DOC-03: fetch-and-store (вариант A) — §10 запрещает отдавать внешний URL напрямую.
- Q5: slug-ключ без миграции; GUID-вариант отложен до фактической необходимости.

## Верификация
- **Unit:** adapter-rest 12/12 (Q10+Q6), writers 20/20 (DOC-03), document-fetch 3/3, mock-1c 39 (вкл. live-mock пагинация-контракт 5/5). Весь oneCSync unit 94/94. typecheck/lint чисто.
- **Integration (WSL live-PG):** `worker.oneCSync.upsert.test.ts` обновлён под DOC-03 (path = storage-ключ, fetch замокан); прогон — за оператором.

## Что осталось (операционка, кода нет)
1. **Shadow-rehearsal** против реальной 1С: `ONE_C_ADAPTER=rest ONE_C_MODE=shadow` + `ONE_C_API_URL/TOKEN` → инспект `/admin/sync` (operation='check', 0 записей, карантин/недоимпорт видны).
2. **Включение:** `ONE_C_MODE=live`.
3. **WSL** integration-прогон обновлённых тестов.
4. A1-встречи 1С нет (контракт наш) — внешнего блокера T2 не осталось.

## Тонкости
- Пагинация исчерпывается за один pull (курсор `since` структурно не менялся); survive-restart-mid-pagination — осознанный non-goal.
- Скан 1С-документов gated на `REDIS_URL` (как commission PDF/XLSX) — в тестах/частичном dev пропускается.
- DOC-03 чинит NEW-доки; легаси bad-path доков в проде нет (1С ещё не была live).
