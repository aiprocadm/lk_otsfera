# T3 — Лиды: партнёр → менеджер → заказ: дизайн

**Дата:** 2026-06-14
**Трек:** T3 из [launch-readiness-roadmap](2026-06-13-launch-readiness-roadmap.md) (🔴 launch-критичный, независимый).
**Метод:** 3 параллельных code-разведки (file:line). Подтверждено в коде.

## Цель
Замкнуть цепочку лид→менеджер→заказ→видимость партнёра. Сейчас: партнёр создаёт лиды, но менеджер их **не видит и не обрабатывает** (ни страницы, ни API, ни переходов статусов), а партнёр видит заказы напрямую через `Order.partnerId`.

## Текущее состояние (разведка)
- `Lead` модель полна: статусы `new→in_review→qualified→promoted_to_order→rejected`, `assignedManagerId`, `promotedOrderId @unique`, `Order.promotedFromLead` backref. Партнёр: `createLead`/`listLeads`/`withdrawLead` ([partner/leads.ts](../../../src/lib/services/partner/leads.ts)).
- **Нет** менеджерского вида лидов (ни `/manager/leads`, ни API, ни lifecycle-переходов, ни назначения, ни промоушена).
- `pushLeadToOneC` существует ([oneCSync/push.ts](../../../src/lib/services/oneCSync/push.ts)), но **триггера нет** — никто не enqueue'ит (роадмап «лид сразу в 1С» фактически неверен).
- Партнёр видит заказы через `Order.partnerId` в 7 read-сайтах (deals/dashboard×4/dealDetail/portfolio).
- F8: `deals.ts` строит `Map` по `companyId` → 2 орг в одной компании дают неверное имя орг.
- S5: статусы лида партнёру **уже видны** (список+детали+табы); пробел — только уведомления о смене статуса.

## Решения владельца (зафиксированы 2026-06-14)
1. **Лид→заказ = локальный заказ в кабинете.** Промоушен создаёт `Order` прямо в кабинете (не round-trip в 1С).
2. **Лид→менеджер = общая очередь команды.** Все менеджеры видят все входящие лиды; любой берёт в работу (назначает на себя). Руководитель/админ тоже могут назначать.
3. **F2 = чистый флип сразу.** Партнёр видит ТОЛЬКО заказы, привязанные к его лидам (`promotedFromLead.partnerId`). Импортированные заказы становятся невидимы партнёру.

## Дизайн

### A. Менеджерский inbox лидов (новое)
- **Scope (по решению 2):** лиды — общая очередь, НЕ scoped по `managedOrgIds`. Менеджер видит **все** лиды (в системе один company-tenant Промтехносфера; у лида нет `companyId`, новый клиент без орг). Фильтры: статус, поиск (clientCompanyName/subject), «назначенные мне». Это сознательное отступление от order-scope (C8): лиды inbound-очередь, не company-bound. Документируется здесь и в CLAUDE.md.
- **Lifecycle-сервис** `manager/leadLifecycle.ts` (Result-контракт §3): `assignLead` (set `assignedManagerId`, `new→in_review`), `setLeadStatus` (валидные переходы), `promoteLead` (создать локальный Order + `promotedOrderId` + `promoted_to_order`), `rejectLead` (`rejected`+reason). Все пишут audit.
- **promoteLead детали:** создаёт `Order` с данными лида (title=subject, partnerId=lead.partnerId, organizationId=lead.organizationId, totalAmount=estimatedAmount, executionStatus='pending', financialStatus='not_billed', **externalId=null**). `externalId=null` ⇒ 1С-синк (upsert по externalId) его не трогает — **конфликта нет**. Транзакция: create Order → set lead.promotedOrderId+status. Идемпотентность: лид уже `promoted_to_order` → Result `already_promoted`.
- **Read-сервис** `manager/leads.ts`: `listManagerLeads` (cursor), `getManagerLead` (детали + attachments).
- **API:** `/api/manager/leads` (GET), `/api/manager/leads/[id]` (GET, PATCH action: assign|setStatus|promote|reject) — тонкие, мапят Result→HTTP (эталон finance/statements/[id]).
- **UI:** `/manager/leads` (список+фильтр+табы статусов), `/manager/leads/[id]` (детали+действия). Компоненты `manager-leads-*` (sibling-паттерн, НЕ переиспользуем partner-* — §4). Nav «Заявки» (flag `manager_cabinet`).
- **Гейтинг:** под `manager_cabinet` (middleware-префикс уже покрывает `/manager`; nav-флаг; route `notFoundIfDisabled`).

### B. F2 — видимость партнёра через лиды (чистый флип)
Переключить 7 read-сайтов с `partnerId: X` на relation-фильтр `promotedFromLead: { partnerId: X }` (чистый Prisma-фильтр, без subquery). Сайты: [deals.ts](../../../src/lib/services/partner/deals.ts), [dashboard.ts](../../../src/lib/services/partner/dashboard.ts) (×4: open/attention-stuck/attention-overdue/recent-events), [dealDetail.ts](../../../src/lib/services/partner/dealDetail.ts), [portfolio.ts](../../../src/lib/services/partner/portfolio.ts). `Order.partnerId` в схеме остаётся (нужен для writer/commission), но видимость на него не опирается. **Поведенческое изменение:** партнёр видит 0 заказов, пока менеджеры не пропромоутят его лиды — принято владельцем.

### C. F8 — коллизия орг в partner-deals
В `deals.ts` маппинг имени орг идёт через `Map<companyId>` → перезапись при 2 орг/компания. Фикс: брать имя орг по `order.organizationId` (точный ключ), не по companyId. Заказы теперь и так фильтруются через лиды (B), у заказа есть `organizationId` → lookup по нему.

### D. S5 — прозрачность статуса лида
Статусы уже видны. Добавить: при смене статуса лида менеджером — уведомление партнёру (`NotificationType.lead_status_changed`, уже в enum) через `notifyPartnerUsers` (расширить union новым типом, как в C-02). Best-effort (§3). Audit смены статуса — через `recordAudit` в lifecycle-сервисе.

## Тестовая стратегия
| Часть | Слой | Тест |
|---|---|---|
| lifecycle | unit | assign/setStatus переходы (валид/невалид), promote создаёт Order+linkage+статус, идемпотентность already_promoted, reject; audit вызван |
| scope | unit | listManagerLeads возвращает все лиды (team queue), фильтр статуса/поиска/assigned-to-me |
| API | unit | PATCH action mapping (assign/promote/reject/setStatus → 200/409), RBAC (requireManager), notFoundIfDisabled |
| F2 | unit/integration | партнёр видит заказ ТОЛЬКО через promotedFromLead; импортированный заказ (partnerId, без лида) невидим |
| F8 | unit | 2 орг/компания → каждый заказ показывает свою орг (не перезапись) |
| S5 | unit | смена статуса → notifyPartnerUsers(lead_status_changed); best-effort не валит |

Гейты: typecheck/lint/`test:unit`; integration (партнёр-видимость, promote) — WSL live-PG; build.

## Порядок реализации (subagent-driven, §8)
1. **lifecycle-сервис** (assign/setStatus/promote/reject + audit) — ядро, unit TDD.
2. **read-сервис** `manager/leads.ts` (team-queue scope) — unit.
3. **API** `/api/manager/leads[/[id]]` — unit.
4. **F2 флип** (7 сайтов на promotedFromLead) + **F8** фикс — unit/integration.
5. **S5** notifyPartnerUsers(lead_status_changed) union + триггер в lifecycle.
6. **UI** страницы+компоненты+nav.

## Вне scope / зафиксировать
- Reconciliation локального заказа с 1С (если 1С создаст ту же сделку — потенциальный дубль). Future; не launch-критично (1С-сделки и кабинетные промоушены — разные потоки на старте).
- 1С push лида (триггер существует-но-не-подключён) — не часть T3 по решению (лид→локальный заказ, не через 1С). Оставить как есть.
- F2 чистый флип = rollout-comms партнёрам (увидят только промоутнутые заказы).
