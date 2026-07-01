# Track A + C (P0) — DONE

**Дата завершения:** 2026-07-01
**Источник требований:** внешнее ТЗ `ТЗ_Разработчик_lk_otsfera_v0.5` (Трек A + C, P0) + бизнес-ТЗ v0.6.
**Base commit:** `c640ea0` (docs(1c): close-out — cursor skipped-record loss…)
**Commits этой поставки:**
- `ac459ca` feat(commission): per-org rate override (Track A) + IDOR/hiding tests (Track C)
- `25a137a` fix(gate): seed terminates on success + integration testTimeout 20s
- (этот close-out) docs

**Branch:** `claude/1c-cursor-store-and-replay` (поставка легла поверх завершённой 1С-cursor работы).

> Примечание: это standalone close-out (плана в `docs/superpowers/plans/` под эту работу не заводили — требования пришли из внешнего ТЗ, а не из внутреннего spec-first цикла). Формат — по эталону `2026-05-22-partner-cabinet-phase4-DONE.md`.

## Трек A — корректность комиссии

### A2 — индивидуальная ставка организации (приоритет №1, разворот раннего решения §6.2)
- **`rateResolve.ts`** — новая чистая `resolveEffectiveRate({ orgOverride, changes, paidAt, partnerDefault })`:
  приоритет **(1) override организации → (2) историческая ставка партнёра (`resolveRateAt`) → (3) дефолт партнёра**.
  `null`/`undefined` = «не задана» (наследуем), любое заданное значение (включая `Decimal(0)`) — явный override.
- **`statement.ts`** — единственная точка выбора ставки на платёж переведена на `resolveEffectiveRate`;
  в select платежа добавлен `organization.partnerCommissionRate`.
- **`corrections.ts`** (`detectLateRefundCorrections`) — та же ставка для сторно возврата.
- **Cross-partner gate (по итогам ревью):** override применяется только если `organization.partnerId === <партнёр ведомости>`
  — платёж может быть отнесён партнёру X через `order.partnerId`, тогда скидка «чужой» организации Y не должна протекать на X.

### A3 — НДС
- Подтверждено тестом (не менялось): `calculateCommission` НЕ принимает `vatAmount` — база = полная сумма платежа,
  вычесть НДС структурно невозможно. Добавлен явный integration-тест «база = 120000 при vatAmount=20000».

### A4 — тесты
- `resolveEffectiveRate`: приоритет override/history/default (+ `Decimal(0)` = override).
- statement (integration): override перекрывает дефолт; override перекрывает историю; fallback история→дефолт; A3-НДС;
  cross-partner gate (unit, `statement.unit.test`).
- corrections (integration): override-консистентность позднего возврата; **нетто<0 → выплата 0 + перенос остатка** (carry-over через `approveStatement`).

## Трек C — безопасность доступа (на уровне API/выборки, не UI)

- **C1** — `c1.commission-hiding.contract.test.ts`: статический guardrail — точки входа кабинета организации
  (`app/organization/**` + `app/api/organization/**`) НЕ ссылаются на комиссионные данные и НЕ импортируют
  комиссионный компонент/сервисы. Поведенческое доказательство (в c3): партнёр-канальный `commission_statement`
  документ невидим своей же организации (канал-изоляция).
- **C2** — `c2.multirole-commission.test.ts`: мультироль-пользователь в контексте «организация»
  (`session.role='organization'` + установленный `partnerId`) получает 403 на комиссионных эндпоинтах;
  гейт по активному `session.role`, а не по объединению ролей (`requirePartner` отвергает до взгляда на `partnerId`).
- **C3** — `c3.idor-cross-access.test.ts`: кросс-доступ по чужому id отклоняется на
  `Order` / `Document` / `Payment` / `CommissionStatement` (read-путь **и** мутирующий `approveStatement`),
  с позитивными контролями на каждый ресурс.

## Адверсариальное ревью (11 агентов, 4 измерения → verify)
5 подтверждённых замечаний (2 отклонены). Все actionable — исправлены:
- **B (fixed):** cross-partner override gate (см. A2 выше) + unit-тесты.
- **C (fixed):** C1 guardrail дополнен запретом импорта `components/organization/org-finance-commission`
  (компонент шарится с менеджерской витриной по дизайну — сам файл не сканируем, но org-страницам импортировать его нельзя).
- **D (fixed):** C3 дополнен cross-partner `approveStatement` (мутирующий IDOR).
- **A (documented):** позднее сторно резолвит историческую ставку на дату ВОЗВРАТА, а не исходного платежа
  (в схеме нет ссылки refund→original). Override-путь точен; rate-history — прокси (в общем случае тот же месяц).
  Реальный фикс требует миграции схемы — вне P0. Комментарий приведён к точной формулировке.
- Отклонены (проверено): C2 «косвенность» (покрыто C1-guardrail'ом), C3 без `resolveActiveOrgId`
  (покрыто `auth.orgContext.test` + download-route тестом).

## Фиксы окружения/гейта (по ходу верификации)
- **`prisma/seed.ts`** — корневая причина зависания `npm run gate`: seed вызывал `process.exit()` только на ошибке;
  на успехе оставлял 3 fire-and-forget сокета (fetch фейкового 1С-адаптера / транспорты) → event loop не осушался.
  Диагностировано инструментированием (`_getActiveHandles` → 3× `Socket`, не Redis). Теперь `$disconnect()` + `process.exit(exitCode ?? 0)`.
- **`vitest.config.ts`** — integration-режим получил `testTimeout: 20000` (unit остаётся 5000). Integration делит один
  Postgres при `fileParallelism:false`; тяжёлые end-to-end ~2–3.5s на тёплую, но превышают дефолтные 5s на холодную под нагрузкой.

## Проверка состояния

```
npm run typecheck        # 0 errors
npm run lint             # 0 warnings / 0 errors
npm run test:unit        # 3382 passed, 3 skipped
npm run gate             # ✓ integration suite green — 490 passed (71 файл), end-to-end одной командой
```

## Файлы
**Код:** `src/lib/services/commission/{rateResolve,statement,corrections}.ts`
**Тесты:** `services.commission.{rateResolve,statement,statement.unit,corrections}.test.ts`, `c1.commission-hiding.contract`, `c2.multirole-commission`, `c3.idor-cross-access`
**Окружение:** `prisma/seed.ts`, `vitest.config.ts`

## Сознательные решения / вне scope
1. **A5 — история override организации** намеренно отложена: применённая ставка фиксируется в `CommissionStatementItem.rate`,
   этого достаточно для воспроизводимости прошлых периодов (§6.2 п.2).
2. **Late-refund rate proxy** (замечание A) — структурное ограничение (нет `refund→original` в схеме), корректировка создаётся
   как `needs_review` (человек проверяет). Фикс требует миграции — отдельная задача.
3. **`markStatementPaid` авторизация** (§6.4: leader/admin/партнёр) — вне explicit-списка A1–A5 этого трека; не трогали.
