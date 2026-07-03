# Track E — Сквозное качество и покрытие — Close-out (DONE)

> Companion to [2026-07-03-track-e-quality-coverage.md](2026-07-03-track-e-quality-coverage.md). План — «что планировали»; этот файл — «что отгрузили». Дата: 2026-07-04.

## Итог

Все пять блоков (E1–E5) отгружены. Найден и исправлен **один настоящий баг безопасности** (cross-tenant утечка комментариев) отдельным `fix`-коммитом. Прод-поведение больше нигде не менялось (кроме документированных `v8 ignore`-комментариев на недостижимом коде — покрытие, не поведение).

**Финальные проверки:** `npm run test:coverage` → **rc=0** (100%-гейт зелёный, **4665 тестов**); `npm run typecheck` → зелёный; `eslint` → зелёный. Статус `npm run gate` — см. §E5 ниже.

## Коммиты

| Хеш | Что |
|---|---|
| `c461caf` | **fix(security):** partner org-comments tab scoped to organization, not seller company (+ failing-first регресс) |
| `27a9e85` | docs(plan): Track E plan |
| `8c0993a` | **test(security):** E2 named net — Lead & partner-commission IDOR + suite manifest |
| `e26dd95` | **test(e2e):** E3 five critical paths |
| `4f414f6` | **test(coverage):** E1 logic-layer 100% gate restored (19 файлов + carve-outs + 9 v8-ignores) |
| `9e115a2` | **test(coverage):** E1 phase-2 — render harness (hooks + email .tsx) → 100% |
| `765db6a` | **test(e4):** no-network determinism guardrail |

## E2 — Единый security-набор (в gate)

Существующие `c1/c2/c3/f/f4` оставлены; добавлены 3 инварианта-гэпа + манифест. Все DB-инварианты — integration-tier → гоняются в `gate` без CI-обвязки.
- `security.idor-lead.integration` — партнёр не читает/списывает/отзывает чужой Lead; scopeOrgIds sub-manager.
- `security.partner-commission-idor.integration` — route-level 404 на чужой statement; finance-сериализатор не течёт чужого партнёра/внутренних полей.
- `security.idor-comments.integration` — cross-tenant изоляция комментариев (регресс к найденному багу).
- `security.suite.manifest` — единая именованная точка; падает при удалении/переименовании инварианта или если DB-инвариант перестал быть integration-tier.

**🔴 Найденный баг (исправлен `c461caf`):** [`org-comments-tab.tsx`](../../../src/components/partner/org-comments-tab.tsx) скоупил комментарии по `companyId` (юрлицо-**продавец**, общее для всех клиентов) → партнёр на `/partner/portfolio/[orgId]?tab=comments` видел разговоры по заказам **всех** организаций и партнёров компании. Фикс — scope по `organizationId`; вынесено в `listOrgOrderComments`; adversarial-проверка (регресс красный на старом коде).

> **Примечание владельцу:** формулировка CLAUDE.md §3.4 «Comment внутренние, скрыты от клиентов» **не соответствует коду** — `Comment` это разговор клиент↔менеджер по заказу (org/partner/manager пишут и читают). Реальный инвариант — cross-tenant изоляция (что теперь и защищено). Обновление §3.4 — отдельным решением.

## E3 — Сквозные E2E (integration, внешние системы замоканы)

`e2e.order-lifecycle` (create→self-assign[reject already_assigned]→waiting_client[reason]→completion BLOCKED пока не выполнены документы+бухгалтерия→complete→reopen[audit]); `e2e.funnel-promotion` (lead new→in_review→qualified→promote→Order, illegal skip отклонён); `e2e.commission-lifecycle` (3-org приоритет ставки: org-override › историч.@paidAt[0.20 после/0.10 до смены] › дефолт; refund; calc→approve→XLSX rows+total; late-refund→carry-over→R2 clamp 0.00); `e2e.notifications-delivery` (email всегда + telegram-mute skip + max sent; детерминированный jobId, идемпотентность); `e2e.payment-import-idempotency` (Card-51: INN-match→Payment, unmatched→queue, supplier(60)→filtered; повтор → externalId dedup, счётчики = 1). **23 теста.**

## E1 — Покрытие: восстановление 100% + фаза-2

**Находка:** 100%-логический гейт **дрейфанул до ~98%** (71 gated-файл, 314 строк + 270 веток непокрыты) — код треков **после** валидации фазы-1 (G1–G4, 1С-import, training, tasks, access, funnel, customFields) слился непокрытым, а гейт гоняется вручную (L3), поэтому просадку не ловили. **Не** от этого трека.

**До → После (gated globs):** lib 97.96%L/95.15%B → **100%**; server-actions 98.97% → **100%**; app/api 99.75% → **100%**; worker 97.58%L/91.42%B → **100%**; middleware **100%**.

Отгружено: 12 module-cov + 7 cov2 + 5 phase-2 тест-файлов. Carve-outs (denominator): 3 type-only/barrel-модуля (`import/oneCAccountCard/types.ts`, `customFields/index.ts`, `import/oneCAccountCard/index.ts`).

**Фаза-2 (render-харнесс):** добавлены `jsdom` + `@testing-library/react`. Хуки (`useFormAction`, `useClientResource`, `useThreadPolling`) — `renderHook`/`act` + fake timers + stubbed fetch; email `.tsx` (все шаблоны + `send.tsx`) — `renderToStaticMarkup`. Новые пороги: `src/hooks/**`, `src/lib/email/**/*.tsx` = 100%; `useFormAction.ts` убран из exclude. **Остаток `components/**` + `app/**/*.tsx` — фаза 3.**

**`/* v8 ignore */` (все с причиной):** parser `?? ''` ×2 (guaranteed-string), extractors dead length-guard, import-batch excludeReason default, commission statement P2002 race-guard (`!winner`), funnel/board inner not_found ×3 (lead pre-checked), oneCSync pending defensive skip, certificate-expiry missing-cert skip, HTTP-client finally exceptional-edge ×3 (bare catch + clearTimeout не бросает), hooks `typeof document` SSR-гарды (мёртвый код — client-effect'ы не исполняются на сервере).

## E4 — Детерминизм / без сети / снапшоты

- **Без сети:** статический guardrail `e4.no-network.guardrail` — падает, если тест конструирует реальный S3/Resend/SMTP-клиент без мока модуля или зовёт `fetch()` без stub'а `global.fetch`. Единственный реальный сетевой — `storage.s3.integration` (skipIf на живой object-store) — в allowlist. Полный sweep: **чисто**.
- **Детерминизм:** все новые тесты — `STAMP` только для уникальности имён, ассерты на детерминированных id/датах/суммах; `fileParallelism:false` сохранён; деньги — `Prisma.Decimal`.
- **Playwright-снапшоты (частично):** спеки + storageState + projects есть для **4 кабинетов** (admin/manager/organization/partner). **leader/student — отсутствуют** (нет спеков/storageState/project). Бейзлайны win32-специфичны и генерируются **вручную локально** (`npm run e2e:visual:update`, требует `npm run dev` + seed + `playwright install`), что по CLAUDE.md §6 — намеренно ручной локальный флоу. **Follow-up:** добавить leader/student projects + спеки и сгенерировать бейзлайны ручным прогоном (не автоматизируется в этом трек-контуре без полного dev+browser стека).

## E5 — Отчёт

Этот документ.

## Оставшиеся follow-up (не блокируют трек)

1. leader/student Playwright-снапшоты (ручная генерация бейзлайнов, §E4).
2. CLAUDE.md §3.4 — привести формулировку про `Comment` в соответствие с кодом (решение владельца).
3. Фаза-3 покрытия: `components/**` + `app/**/*.tsx` (отдельный план).
