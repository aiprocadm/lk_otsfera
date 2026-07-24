# Этап 3 PR-1 — реестры удостоверений и карточка сотрудника

Спека: [2026-07-24-stage3-certificates-registry-design.md](../specs/2026-07-24-stage3-certificates-registry-design.md) §5.1–5.4, §6.
Ветка: `claude/stage3-certificates-registry`. PR-2 (экспорт + документы) — следующим.

## Объём

1. **Флаг `certificates_registry`** (opt-in): `featureFlags.ts` (+OPT_IN),
   `middleware.ts` (префиксы `/organization/certificates`, `/partner/certificates`),
   nav-пункты «Удостоверения» (organization + partner), строка в
   `docs/feature-flags-matrix.md`. Карточка сотрудника — page-гейт (префикс
   `/organization/students` не гейтится — список существует без флага).
2. **Сервис** `training/certificates.ts` — `listCertificates` расширяется
   опциями `{ organizationId?, directionId?, status?('active'|'expiring'|'expired'),
   search?, take?, skip?, now? }`, возврат `+total` (обратная совместимость:
   `certificates` остаётся). Статус — SQL-границы по `validUntil`
   (порог 60 дней, `EXPIRING_WITHIN_DAYS`). Включается `organization {id,name}`
   (колонка партнёра). Фикс скоупа: partner-manager (`partnerRole='manager'`)
   видит пересечение организаций партнёра с `assignedOrgIds`.
3. **Компоненты** `src/components/certificates/`:
   `certificate-status-badge` (действует/бессрочно · истекает ≤60 · истекло),
   `certificate-registry-table` (опц. колонка «Организация», ссылка на карточку
   сотрудника, `CertificateDownloadButton` / «скан готовится»),
   `certificate-registry-filters` (GET-форма: направление, статус, поиск ФИО,
   опц. организация — по образцу SearchForm сотрудников).
4. **Страницы**: `/organization/certificates` (OrgAppShell, activeOrg-скоуп,
   пагинация 50/200 как students), `/partner/certificates` (+фильтр/колонка
   «Организация»), `/organization/students/[id]` (шапка, удостоверения,
   история обучения по `OrderItem.trainingStatus`, чужой id → notFound);
   ФИО в таблице сотрудников — ссылка на карточку (при флаге).
5. **Дашборды**: `expiringCertificates()` в organization/partner dashboard-сервисах
   (count ≤60 дней, не истёкшие); опциональная 5-я карточка в `OrgKpiGrid`/`KpiGrid`
   «Истекают удостоверения: N» → реестр `?status=expiring`; страницы дашбордов —
   по образцу `recentEnrollments` (флаг off → не считаем и не рендерим).

## Тесты

Unit: сервис (where-границы статусов, пагинация, скоупы, partner-manager),
dashboard-счётчики, компоненты (бейдж/таблица/фильтры), страницы (флаг off →
notFound; чужой сотрудник → notFound; успех), KPI-карточки (рендер при флаге).
Integration (живой Postgres): фикстуры организаций/сертификатов → фильтры
статусов/направления/поиска, скоупы org/partner/partner-manager, total.
Существующие потребители `listCertificates` — без изменений контракта.

## Гейты

typecheck / lint / unit зелёные; integration по затронутым местам; CHANGELOG;
STATUS.md; PR. Существующие nav-/kpi-тесты при расширении меню — актуализируются.
