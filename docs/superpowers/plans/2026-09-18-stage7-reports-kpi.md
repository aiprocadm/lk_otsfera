# Этап 7 «Отчёты и KPI» — план

Спека — [2026-09-18-stage7-reports-kpi-design.md](../specs/2026-09-18-stage7-reports-kpi-design.md)
(подтверждена мержем [#639](https://github.com/aiprocadm/lk_otsfera/pull/639);
решения `Р-Э7-1`…`Р-Э7-8`, умолчания вопросов `В-7-1`…`В-7-6` действуют).
Требования `У-242`…`У-250`. Четыре PR, каждый от `main`, с зелёными
`typecheck:src` · `typecheck:tests` · `lint` · `boundaries` · `deadcode` ·
`dup:check` · `format:check` · `tz:status` · unit ×4 · integration ×4 (живой
Postgres) — локально, CI не запускается. Каждый новый страж проверяется
мутацией до PR.

REQUIRED SUB-SKILL: superpowers:subagent-driven-development

## PR-1. Реестр метрик и хаб KPI (`У-242`)

- [x] Миграция: `SalesTarget.metric String @default('revenue_paid')`, уникальность `(companyId, managerId, year, month, metric)`, индекс `(companyId, year, month, metric)`; `Company.activeKpiMetrics String[] @default([])`
- [x] `src/lib/kpi/metrics.ts` — реестр из десяти метрик (ключ, название, единица, `perManager`, объяснение, расчёт факта за период через `groupBy`/один запрос)
- [x] `src/lib/kpi/plan.ts` — план и факт по активным метрикам: строки «менеджер × метрика», итог по команде, процент, сравнение с прошлым месяцем
- [x] `leadCompanyWhere` (`Р-Э7-2`) в `src/lib/auth/leadScope.ts`; воронка переведена на него — лид чужой компании больше не считается
- [x] Сервис `src/lib/services/kpi/settings.ts`: активные метрики (не больше восьми, проверка на сервере), планы по менеджерам, копирование с прошлого месяца; аудит `kpi_settings_changed`, `kpi_target_changed`
- [x] Раздел хаба `catalogs.kpi` → `/{admin,leader}/settings/processes/kpi`: право `settings.catalogs.manage`, флаг `leader_analytics`, значок из реестра; экран с выбором метрик и таблицей планов
- [x] Server actions `src/server-actions/kpi.ts`: `setActiveMetricsAction`, `upsertTargetsAction`, `copyTargetsFromPreviousMonthAction`
- [x] Стражи: `kpi.registry-complete` (у каждой метрики название, единица, объяснение; активных ≤ 8), `security.lead-company-scope` (мутация: вернуть `assignedManagerId: null`)
- [x] Тест каждой метрики на фикстуре: пустой период → ноль, возвраты вычитаются, чужая компания не считается
- [x] AUDIT `У-242` → ✅; CHANGELOG; STATUS

## PR-2. Вкладки аналитики, источники, производительность (`У-243`, `У-247`, `У-248`)

- [x] Вкладки на `/leader/analytics`: План/факт · Воронка · Коммуникации · Дебиторка · Партнёры (общий компонент вкладок, названия из одного словаря)
- [x] `services/leader/receivables.ts` — долг по организациям: выставлено, оплачено, долг, дней с даты счёта, ответственный, итог по компании, фильтр «старше N дней»
- [x] `services/leader/communications.ts` — время первого ответа по каналам и менеджерам (§5.3 спеки, один сырой SQL), доля просрочки SLA, входящие без ответа, звонки принятые/пропущенные по `answeredAt`
- [x] `services/leader/sources.ts` — лиды и обращения по источникам → сделки → заказы, конверсия каждого шага (`У-247`)
- [x] `services/leader/partnersAnalytics.ts` — начислено/выплачено, активные организации, обращения по партнёрам
- [x] Те же вкладки в `/admin/finance` с выбором компании (`Р-Э7-8`)
- [x] Индексы `Order`: `(companyId, createdAt)`, `(companyId, completedAt)`, `(companyId, closedAt)`, `(companyId, deadline)`
- [x] Страж `reports.no-n-plus-one` (мутация: вписать `await` в цикл)
- [x] Интеграционный тест с тайм-лимитом: фикстура 100 000 заказов, отчёт за месяц < 2 с. Не уложились — `Р-Э7-4`, цифры заказчику
- [x] AUDIT `У-243`, `У-247`, `У-248` → ✅; CHANGELOG; STATUS

## PR-3. Реестр отчётов, выгрузка, права (`У-244`, `У-249`)

- [ ] `src/lib/reports/registry.ts` — шесть отчётов (ключ, название, роли, параметры, колонки, выборка со скоупом внутри)
- [ ] `src/lib/reports/export.ts` + `GET /api/reports/[key]/export` — XLSX общим помощником, `REPORT_ROW_LIMIT = 50 000`, отказ ДО выборки с русской подсказкой
- [ ] Вкладка «Экспорт» в «Аналитике» и кнопка «XLSX» на каждой вкладке
- [ ] Права: менеджер → 403 до выборки; партнёр → только свои начисления; `see_commission` в `partner_accruals`
- [ ] Стражи: `reports.registry-complete` (реестр ↔ вкладка «Экспорт»), `security.reports-scope` (мутации: снять 403 менеджеру; отдать чужую компанию)
- [ ] Тест колонок и скоупа на каждый из шести отчётов
- [ ] AUDIT `У-244`, `У-249` → ✅; CHANGELOG; STATUS

## PR-4. Дашборды, стражи мутацией, close-out (`У-245`, `У-246`, `У-250`)

- [ ] «Мои KPI за месяц» в `manager-kpi-grid.tsx`: активные метрики компании с планом и фактом менеджера, только свои; плитки кликабельны
- [ ] Переименование «Пропущенные звонки» → «Входящие без разбора» (`Р-Э7-6`), расчёт не меняется
- [ ] Кросс-компанийные плитки админа: заказы/оплаты/лиды/обращения за месяц по компаниям, документы не выгружены в 1С, последний пакет миграции
- [ ] Глоссарий: «KPI», «План/факт», «Дебиторка», «Первый ответ» — в оба источника со стражем полноты
- [ ] Сводная мутация всех стражей этапа — таблица в AUDIT и close-out
- [ ] Прицельный замер покрытия файлов этапа → 100 / 100 / 100 / 100
- [ ] AUDIT `У-245`, `У-246`, `У-250` → ✅; CHANGELOG; STATUS (этап закрыт, текущий — 8); CLAUDE.md снимок
- [ ] Close-out `2026-09-18-stage7-reports-kpi-DONE.md`
