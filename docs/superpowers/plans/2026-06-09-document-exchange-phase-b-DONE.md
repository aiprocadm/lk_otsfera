# Document Exchange Phase B — DONE

**Дата завершения:** 2026-06-10
**PR:** #108 (merged, merge-commit `532186e`)
**Branch:** `claude/document-exchange-phase-b`
**Spec:** [2026-06-09-document-exchange-phase-b-design.md](../specs/2026-06-09-document-exchange-phase-b-design.md) (`a9d943c`)
**Plan:** [2026-06-09-document-exchange-phase-b.md](2026-06-09-document-exchange-phase-b.md) (`f8a3d13`)

## Что отгружено

Order-less «Общие документы»: документ теперь может принадлежать связке `(counterparty, company)` вместо конкретного заказа, с сохранением канальной изоляции Phase A.

### Схема (Task 1, атомарный — включил Tasks 4–5)
- `Document.orderId` → nullable; новый nullable `Document.companyId` (anchor для order-less) + индекс (`f713d3e`).
- **DB CHECK XOR**: ровно одно из `orderId`/`companyId` заполнено — инвариант на уровне БД, миграция `20260610000000_document_order_less`.
- Null-cascade по всем читателям `orderId`/`order`: nullable row-types (org/partner/manager списки), `DocumentLike` в `policy.ts`, `?.`-derefs в dashboard'ах — одним коммитом, иначе pre-commit typecheck-гейт не проходит.

### Policy — единственный источник правил (Task 2)
- `documentChannelPolicy.ts`: ось order-bound/order-less, `managerOrderLessWhere`, `canManagerUploadOrderLess`, `canReadOrderLessDocument` (`a5e2c4b`).
- Направления order-less: **org — двунаправленно, partner — только входящие** (partner не загружает order-less).
- Manager scope для order-less — **company-level, НЕ teamMode-aware** (teamMode партиционирует заказы, которых у order-less документов нет). Cross-company изоляция сохранена.

### Сервисы и роуты (Tasks 3, 6–10)
- `upload-core.ts`: order-less ветка (companyId + counterparty storage-path) с runtime XOR-guard (`8fbf91d`, `c81f591`).
- `manager/counterparties.ts`: деривация counterparty-picker'а — managed orgs + партнёры, чья company-union содержит компанию менеджера (`198bc5c`).
- `manager/uploads.ts` → `createManagerOrderLessDocument` (scoped counterparty, company-pinned) (`6085ae7`).
- API-роут `POST /api/manager/documents/order-less` — тонкий, только маппинг Result-кодов (`d758b22`).
- Read-сервисы: order-less списки для org/partner/manager (`3a09083`); download-авторизация через все гарды (`774bca5`) + hardening: принудительный re-fetch в `canReadDocument` при отсутствии company anchor (`d572aae`).

### Уведомления (Task 7)
- Company-scoped получатели + `notifyManagersOrderLess` (`8c61bb7`).
- Ссылки ведут на «Общие документы», не на `/orders/null` (`290eaee`).

### UI (Tasks 11–13)
- Org: вкладка «Общие документы» + inline upload-форма (`6024264`).
- Partner: read-only вкладка (`77118c6`); метка «Общий документ» в списке (`b19fd5f`).
- Manager + admin: order-less секция с counterparty-picker'ом (`f8f36d6`); a11y-labels на форме (`da087fb`).
- Order-less документы исключены из order-центричных dashboard-фидов; null-safe hrefs (`73d41aa`).

### Инвариант изоляции (Task 15)
- `services.order-less-isolation.test.ts`: менеджер компании A не видит order-less документ компании B (`ba05010`).

## Проверка состояния

| Гейт | Результат |
|---|---|
| `npm run typecheck` / `npm run lint` | чисто (на ветке перед merge) |
| Unit-suite | 1334 passed |
| **Integration против живого Postgres** | **58 файлов, 390/390 passed** (2026-06-10, WSL-путь, чистая БД `cabinet_phaseb`: migrate deploy → seed → full suite) |
| `npm run build` | successful |

Live-PG прогон выполнен **после merge** (Docker-gate на этой машине сломан — см. memory о WSL-пути): полный integration-suite с применённой миграцией `document_order_less`, включая оба инварианта изоляции (Phase A `services.document-channel-isolation` 4/4 и Phase B `services.order-less-isolation` 2/2), `services.manager.counterparties`, `api.manager.documents.order-less`, XOR в `schema.document.test.ts`. Регрессий нет.

## Deviations / gotchas (для будущих фаз)

1. **Task 1 атомарен с Tasks 4–5** (`38119ec`): pre-commit typecheck-гейт не позволяет закоммитить nullable `orderId` отдельно от null-cascade. Зеркалит атомарный schema-task Phase A.
2. **Manager download был POST → 405** (`da087fb`): manager-кнопка скачивания шла POST'ом на GET-роут; всплыло только при ручном smoke.
3. **`/orders/null` в уведомлениях** (`290eaee`): order-less ветка нотификаций сначала переиспользовала order-bound шаблон ссылки.
4. **Seed виснет вне Docker-окружения**: `prisma/seed.ts` импортирует worker-процессоры → `jobs/queues.ts` создаёт BullMQ-очереди → открытое Redis-соединение держит event loop, процесс не завершается сам. На gate-пути маскируется тем, что контейнеры живут в compose; при ручном прогоне — убивать после записи данных или закрывать очереди.

## Что осталось (вне скоупа Phase B)

- Roadmap-хвост проекта: Track A (живой 1С REST — внешний блокер, встреча), operator-rollout org/manager кабинетов (Stage 2–4 runbook'а), lock `column-map.ts` на реальный экспорт-образец 1С (Task 9.2 из 1c-file-import).
- Phase A close-out файл не создавался (только план) — при желании восстановить ретроспективно.
