# Журнал доступа к ПДн (§25.7) — close-out

**Дата:** 2026-07-11 · **Ветка:** `claude/pii-access-journal` (от tip `claude/release-hardening-r0`, e82ba45) · **План:** [2026-07-11-pii-access-journal.md](2026-07-11-pii-access-journal.md) · **Спека:** [2026-07-11-pii-access-journal-design.md](../specs/2026-07-11-pii-access-journal-design.md)

## Что отгружено (все 16 задач плана)

- **`PiiAccessEvent`** — отдельная append-only модель, миграция `20260711095014_pii_access_event` (GIN по `subjectIds` + 3 btree), back-relation в `User`.
- **`src/lib/pii/contexts.ts`** — реестр 12 контекстов (единая точка правды subjectType/action/labelRu/callSite).
- **`src/lib/pii/record.ts`** — `recordPiiAccess`/`recordPiiAccessMany`: awaited, never-throws (fail-open §3, `log.error`), сам отсекает не-staff/пустые выдачи/выключенный флаг; leader-снапшот роли.
- **12 инструментированных контекстов**: students list/view, lead view, enrollments, org-card (два события одним `createMany`), inbox, calls, certificates, orderItems, admin users list/view.
- **Guardrail** `pii.capture-coverage.guardrail.test.ts` — контекст без вызова в callSite и rogue-контексты мимо реестра валят прогон.
- **`/admin/pii-access`** — сервис `listPiiAccess`/`listPiiAccessFilters` (только точные индексируемые фильтры, GIN `has` по субъекту, батч-резолв имён без N+1, cursor-пагинация) + страница с graceful-баннером при kill-switch + nav-пункт.
- **Флаг `pii_access_log`** — opt-out; в тестовом env заглушён setup-файлом (`vitest.setup.ts`), тесты журнала включают явно.
- **Приведения к канону**: `getManagerLead(prisma, session, leadId)`; `listUsers/getUser(prisma, session, …)`; инлайн-чтение студента из RSC вынесено в `getStudent` (C8 teamMode сохранён, scope-тесты переехали в unit сервиса).
- **Доки**: `.env.example` / `.env.production.example`, `docs/feature-flags-matrix.md` (19 флагов: 5 opt-out), CLAUDE.md §5/§12.

## Верификация

- `npm run typecheck` — чисто; `npm run lint` — 0 warnings.
- `npm run gate` — **916 integration-тестов, 117 файлов** зелёные (нулевой blast-radius: заглушка флага сработала).
- `npm run test:coverage` — **6693 теста зелёные (738 файлов), 100%-пороги удержаны** (exit 0).
- Integration журнала: 4/4 (GIN `has`, `createMany`, leader-снапшот, kill-switch).

## Отличия от плана (все зафиксированы в коммитах)

1. **SSR-артефакты `renderToString`**: соседние текст+выражение в JSX дают `<!-- -->` — компоненты переведены на template-literals (видимый вывод идентичен), тесты плана без изменений.
2. **Канон-тесты навигации** (`components.admin-sidebar`, `navigation.cabinet.partner`): счётчики admin-ссылок 19→20 — обновлены в Task 14 (план предвидел через grep-правило).
3. **Coverage-препфлайт вместо слепого полного прогона**: точечный `--coverage.include` по новым файлам выявил и закрыл 5 веток (meta.cursor, labelRu-fallback, резолв всех 6 типов субъектов, cursor+skip, actor=null, page-фильтры) за минуты, а не за 40-минутные итерации гейта. Один `/* v8 ignore next */` — structurally-unreachable `?? []` под has-гардом (с причиной-комментарием, конвенция проекта).
4. **Red-фаза Task 2** подтверждена через `typecheck` (vitest не типчекает) — механизм отказа тот же, что ожидал план.

## Открытый вопрос владельцу (из спеки)

**Fail-open vs fail-closed**: реализован fail-open по §3. Комплаенс-аргумент за fail-closed («доступ без следа хуже отказа страницы») требует санкции на изменение правила CLAUDE.md; апгрейд локален — один хелпер + error-код `pii_log_failed` в ~12 сервисах.

## Следующие шаги серии

PR ветки → main **строго после** PR #196 (иначе повторится ловушка stacked-PR из [#195](https://github.com/aiprocadm/lk_otsfera/pull/195)). Из серии укрепления это был последний пункт.
