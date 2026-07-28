# T1 — Единый контракт ингестии 1С: close-out (PARTIAL)

> **✅ ЗАКРЫТО (подтверждено сверкой кода 2026-07-28).** Файл был помечен
> `PARTIAL` из-за двух незакрытых пунктов — прогона integration на живом
> Postgres и PR в main. Оба закрыты: в `main` лежат `src/lib/services/import/`
> и `src/__tests__/import.unified.integration.test.ts`. Ниже — исторический
> срез на 2026-06-13, статусы отдельных задач в нём не обновлялись.

**Дата:** 2026-06-14
**Ветка:** `claude/t1-ingestion-spec`
**План:** [2026-06-13-t1-ingestion-contract.md](2026-06-13-t1-ingestion-contract.md) · **Спека:** [../specs/2026-06-13-t1-ingestion-contract-design.md](../specs/2026-06-13-t1-ingestion-contract-design.md)

## Что отгружено (код-комплит)

Excel- и API-ингестия 1С сведены к **одному контракту + одному writer'у**. Реализовано subagent-driven (implementer + 2-стадийное ревью на задачу), все коммиты на ветке `claude/t1-ingestion-spec`:

| Задача | Коммит | Суть |
|---|---|---|
| 1 | `fb9eb43` | `translate.ts` — RU-статусы 1С → enum (закрывает и Q10-мину T2) |
| 2 | `ce12e24` | контракт оплаты org-level (`orderId` опционален) |
| 3 | `6965619`+`edc8633` | `resolveOrganizationRef` (externalId∨ИНН + backfill; фикс stale-return по ревью) |
| 4 | `ba95736` | `importScope` → `oneCSync/` (старый путь = ре-экспорт) |
| 5 | `0938d62` | `upsertOrderRecord` (extract из sync-orders) |
| 6 | `851d987` | `upsertPaymentRecord` (order∨org-level) |
| 6.5 | `e6ed51a` | **dual-key**: `organizationInn` в DTO заказа/оплаты (решение владельца) |
| 7 | `b1ac73a` | `upsertOrgRecord` + `upsertDocumentRecord` (faithful extract) |
| 8 | `d7ef107` | опц. колонки `Статус оплаты` / `Заказ` |
| 9 | `a14023f` | `FileOneCAdapter` (Excel→DTO, org-by-ИНН, attach-only, hybrid-статус) |
| 10 (+12+13) | `37bd79d` | переписан `import/index.ts` на unified writer + guard загрузки (F5) + UI-отчёт BatchSummary |
| 11 | `8e63bdc` | удалён расходящийся пайплайн (−756 строк) + guardrail «нет второго writer'а» |
| 15 | `3141715` | integration-тест паритета Excel↔API + scope (написан) |
| holistic | `27b2f2c` | graceful notify fan-out в order/document writers (§3) |

**Закрыты находки аудита:** F1 (статус заполняется всегда) · F3 (оплата↔заказ) · F4 (isRefund) · F5 (size/MIME guard) · F7 (видимый карантин-отчёт вместо тихого недоимпорта).

**Решения владельца, зафиксированные в коде:** идентичность организации = externalId∨ИНН (двойной ключ); Excel **только привязывает** к существующим орг (не создаёт); партнёр приходит с орг из API (ключ-партнёра-расхождение снято).

## Верификация
- **Unit:** 1511/1511 зелёных (198 файлов) после удаления −756 строк.
- **Typecheck / lint / `npm run build`:** чисто (PASS).
- **Guardrail:** `import.no-second-writer.guardrail.test.ts` — нетривиален, ловит прямые write в `import/`.
- Каждая задача прошла spec-compliance + code-quality ревью; финальное холистическое ревью поймало §3-баг (notify без try/catch) — исправлен.

## Статус фаз / что осталось (PARTIAL)

- [ ] **Task 15 — прогон integration на живом Postgres.** Тест НАПИСАН и структурно отревьюен, но на этой машине Docker headless падает / нет БД `cabinet` на :5432. Запуск — за оператором по WSL-пути (`npm run test:integration -- import.unified`), как закреплённый паттерн проекта ([[project-wsl-live-pg-verification]]).
- [x] **Task 14 (F6) — RESOLVED 2026-06-14 (решение владельца делегировано агенту).** Семантика оставлена «стоимость активной работы» (executionStatus-ось); НЕ унифицирована под billed (это разные метрики, сведение убило бы сигнал загрузки команды). Финансовая агрегация не тронута. Расхождение осей сделано явным на UI (подпись в [leader/dashboard/page.tsx](../../../src/app/leader/dashboard/page.tsx) + колонка «Сумма в работе») и зафиксировано комментарием в [leader/dashboard.ts](../../../src/lib/services/leader/dashboard.ts), чтобы не «выровняли» обратно. typecheck/lint зелёные.
- [ ] **PR** в main (после прогона integration).
- Перед боевым 1С (вне T1, в T2): значения `translate.ts` сверить с реальной выгрузкой; pre-check дублей ИНН (M5).
