# Spec — аудит семейства «Финансы» (Track D, SP2)

Дата: 2026-06-22. Трек: D «логика действий в приложении». Подпроект: SP2 (после SP1 «Заказы»).
Методология **наследуется** от SP1 — см. `docs/superpowers/specs/2026-06-21-orders-family-audit-design.md`.

## Цель

Свести экраны «Финансы» по всем ролям бок о бок и зафиксировать неконсистентность UX/флоу
по 6 осям. Где находка является **прямым продолжением уже ратифицированного канона Заказов**
(R1 «заголовки/font», R3 «basePath детали», F2 «дедуп презентационных утилит») — чинить в этом же
проходе без отдельной ратификации. Где находка — новое решение (sibling-vs-shared, тексты
подзаголовков) — выносить в «Открытые решения для владельца».

## Скоуп — что входит в семейство «Финансы»

Страницы (5 ролей):
- `src/app/partner/finance/page.tsx` — комиссионные отчёты + KPI заработка + `ManualCalcForm`
- `src/app/organization/finance/page.tsx` — KPI задолженности + журнал платежей
- `src/app/manager/finance/page.tsx` — оплаты по организациям в scope
- `src/app/leader/finance/page.tsx` — оплаты + комиссия по всей компании
- `src/app/admin/finance/page.tsx` — оплаты по всем организациям (unscoped)

Компоненты:
- `src/components/partner/commission-statements-list.tsx`, `.../manual-calc-form.tsx`
- `src/components/manager/manager-finance-view.tsx`, `.../manager-finance-payments.tsx`
- `src/components/organization/org-finance-kpis.tsx`, `.../org-finance-payments.tsx`, `.../org-finance-commission.tsx`
- `src/components/dashboard/stat-card.tsx` (общий KPI-примитив)

Сервисы:
- `src/lib/services/partner/finance.ts` (commission statements)
- `src/lib/services/organization/finance.ts` (payments ledger + intermediary commission — каноничный источник `OrgPaymentRow`/`OrgFinanceKpis`)
- `src/lib/services/manager/finance.ts` (тонкий агрегатор поверх organization/finance, гейт комиссии)

API (partner-only): `src/app/api/partner/finance/**` (statements list/detail/approve + PDF/XLSX download).

## Доменное замечание (намеренное расхождение, НЕ баг)

Партнёрский «Финансы» — **другая доменная модель**: это комиссионные отчёты (что партнёр *заработал*),
с выгрузкой PDF/XLSX и ручным расчётом за период. У org/manager/leader/admin «Финансы» — **журнал
платежей** (что организации *оплатили*) + KPI задолженности + (для leader/admin) оценка комиссии
посредника. Эти два домена не сводятся к одному списку. Унификация структуры партнёра с остальными —
вне скоупа. В скоупе — единообразие «обёртки»: заголовки, форматтеры, обратная связь, навигация.

## Тестовая стратегия

- Затронутые компоненты — `.tsx` (PHASE-2, не под coverage-порогом), но покрыты renderToString unit-тестами
  (`components.manager-finance.test.tsx`). Любой новый prop с дефолтом не должен ломать существующие
  ассерты; новые ветки (basePath admin/leader, `?org=`) — новые кейсы.
- Гейты перед PR: `typecheck` / `lint` / `test:unit` / `build`. Integration по финсервисам уже есть
  (`services.*.finance*`), их контракт не трогаем.
