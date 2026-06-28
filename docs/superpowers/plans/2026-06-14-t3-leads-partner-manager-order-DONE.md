# T3 — Лиды: партнёр → менеджер → заказ: close-out (DONE, код)

**Дата:** 2026-06-14
**Ветка:** `claude/t1-f6-leader-axes`
**Спека:** [../specs/2026-06-14-t3-leads-partner-manager-order-design.md](../specs/2026-06-14-t3-leads-partner-manager-order-design.md)

Замкнута цепочка лид→менеджер→заказ→видимость партнёра. Всё по TDD, 3 предварительных Explore-разведки (file:line), решения процесса — владельца.

## Решения владельца (2026-06-14)
1. Лид→заказ = **локальный заказ в кабинете** (промоушен создаёт Order; `externalId=null` → 1С-синк не трогает).
2. Лид→менеджер = **общая очередь команды** (все менеджеры видят все лиды, берут на себя).
3. F2 = **чистый флип** (партнёр видит заказы только через свои лиды).

## Отгружено
| Часть | Коммит | Суть |
|---|---|---|
| lifecycle-сервис | `7f2e71a` | assign/setStatus/promote/reject (throw-based + audit). promote создаёт локальный Order (требует орг — `Order.companyId/organizationId` NOT NULL). |
| F2 + F8 | `188b067` | партнёрская видимость заказов через `promotedFromLead.partnerId` (7 read-сайтов); имя орг per-order через relation (F8 коллизия Map устранена). |
| read-сервис + API + UI + nav + S5 | *(этот коммит)* | `manager/leads.ts` (team-queue, без per-manager scope); API `/api/manager/leads[/[id]]` (GET+PATCH assign/setStatus/promote/reject, throw→HTTP); страницы `/manager/leads` + `/manager/leads/[id]` + компоненты (table/filter/actions, переиспользуют `LeadStatusBadge`); nav «Заявки» (flag `manager_cabinet`); S5 — `notifyPartnerUsers(lead_status_changed)` (in-app) при сменах статуса. |

## Архитектурные заметки
- **Team-queue scope** — сознательное отступление от C8 order-scope: лиды inbound-очередь, у них нет `companyId`, кабинет single-tenant. RBAC = `requireManager`; per-manager фильтра нет (есть опц. «мои»). Задокументировано в спеке.
- **promote требует организацию** — лид нового клиента без орг триажится, но не конвертируется, пока орг не появится (инвариант данных, не баг). UI показывает подсказку, кнопка disabled.
- **F2 чистый флип** — импортированные заказы (partnerId, без лида) становятся невидимы партнёру. `Order.partnerId` в схеме остаётся (writer/commission). Поведенческое изменение → rollout-comms партнёрам.
- **S5** — in-app уведомление (email-шаблона нет; `sendEmail` в view сделан опциональным).

## Верификация
- **Unit:** lifecycle 11, manager/leads 3, api.manager.leads 8, notifications.partner 6 — зелёные. typecheck/lint чисто. Полный unit + build — см. ниже.
- **Integration (WSL live-PG):** F2/F8 инвариант (`services.partner.deals.f2f8.test.ts`: импортированный заказ невидим, lead-заказ виден, 2 орг/компания → своя орг); партнёрские dashboard-сиды пересажены на lead-связанные заказы. promote/lifecycle против живой БД — за оператором.

## Осталось / вне scope
- Reconciliation локального заказа с 1С (если 1С создаст ту же сделку → потенциальный дубль) — future, не launch-критично.
- 1С push лида (триггер существует-но-не-подключён) — намеренно не часть T3 (лид→локальный заказ).
- Привязка организации к лиду менеджером (для промоушена org-less лида) — future UX; сейчас орг ставит партнёр при создании.
- Email-уведомление о смене статуса лида (сейчас in-app) — future.
- F2 rollout-comms партнёрам.
