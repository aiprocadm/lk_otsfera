# Этап 9 «Очистка и упрощение» — план работ

**Спека:** [2026-09-18-stage9-cleanup-design.md](../specs/2026-09-18-stage9-cleanup-design.md)
**Требования:** `У-259`…`У-267` · **Дефекты:** `Д-41`, `Д-42`, `Д-43`, `Д-47`, `Д-49`
**REQUIRED SUB-SKILL:** superpowers:subagent-driven-development

Порядок PR нарушать нельзя: `У-261` — два PR (отчёт до миграции, §5 ТЗ), флаги — пачками по три.
Каждый PR: `base: main`, зелёные `typecheck` ×2 / `lint` / `boundaries` / `deadcode` / `dup:check` /
`format:check` / `tz:status`, полный `test:unit`, при правках схемы и сервисов — `npm run gate`.
Каждый новый страж — **проверен мутацией** (поломка вносится и откатывается из `.bak`).

---

## PR-1 — `У-259` + `У-260`: гигиена репозитория

- [ ] `git rm --cached seed.err.log seed.out.log worker.err.log worker.log`
- [ ] `.gitignore`: общее правило `*.log` + исключение для намеренно хранимых логов (если такие есть)
- [ ] Страж `repo.no-log-files.guardrail.test.ts`: под git нет путей `*.log`; список исключений пуст
- [ ] Мутация: добавить пустой `x.log` в индекс → страж красный → откатить
- [ ] README §«Явная RBAC-матрица» → таблица Web routes из `protectedPrefixes`: колонки
      `admin · leader · manager · partner · organization · student`, строки `/admin`, `/leader`,
      `/manager`, `/partner`, `/organization`, `/student`
- [ ] Строка-пояснение Model A: admin управляет через `/admin/*`-зеркало, в чужие кабинеты не входит
- [ ] Таблица API-роутов README: сверить с `security.role-access-matrix` или заменить ссылкой на страж
- [ ] Страж `docs.readme-rbac.guardrail.test.ts`: генерирует таблицу из `access.ts` и сравнивает с README
- [ ] Мутация: поменять роль в `protectedPrefixes` → страж красный → откатить
- [ ] CHANGELOG

## PR-2 — `У-267`: `xlsx` → `exceljs`

- [ ] Тест «золотой слепок»: прогнать существующие фикстуры (выписка 51, карточка контрагента)
      **старой** библиотекой, записать результат в фикстуру-эталон
- [ ] Внутренний интерфейс чтения книги (`readWorkbook`) — один вход для обоих вызывающих
- [ ] [workbook.ts](../../../src/lib/services/import/workbook.ts) → `exceljs`
- [ ] [oneCAccountCard/read-spreadsheet.ts](../../../src/lib/services/import/oneCAccountCard/read-spreadsheet.ts) → `exceljs`
- [ ] Три теста с прямым `import * as XLSX` переписать на сборку фикстур через `exceljs`
- [ ] Слепок совпал (даты, числа, пустые ячейки, объединённые шапки)
- [ ] `xlsx` из `package.json`; `npm audit --omit=dev` = 0
- [ ] CHANGELOG

## PR-3 — `У-261` (а): отчёт, снятие кода, страж

- [ ] `scripts/report-dead-tables.ts` + npm-скрипт `report:dead-tables`: число строк в
      `SavedView`, `Upload` и число лидов `source = partner_legacy` (для `Р-Э9-7`)
- [ ] Прогнать отчёт против Docker-Postgres (`npm run gate` поднимает базу) — зафиксировать вывод в PR
- [ ] `findBlocker` в [mergeExternal.ts](../../../src/lib/services/orders/mergeExternal.ts): убрать
      `prisma.upload.count` и `uploads` из условия `has_activity`; комментарий, почему это безопасно
- [ ] Интеграционный тест `mergeExternal`: ветку `has_activity` доказывать комментарием/тредом,
      а не загрузкой
- [ ] [admin/users/mutations.ts](../../../src/lib/services/admin/users/mutations.ts):75,193 —
      `roleInPartner: 'member'` → `'manager'`
- [ ] Сузить тип записи `roleInPartner` до `'admin' | 'manager'` там, где он ещё `string`
- [ ] Страж `prisma.dead-models.guardrail.test.ts` по `Р-Э9-5` (три канала доказательств)
- [ ] Мутация: добавить `model ZzDead` в схему → страж красный → откатить
- [ ] CHANGELOG

## PR-4 — `У-261` (б): миграция

- [ ] Миграция: `DO $$` — если `count("SavedView") > 0` или `count("Upload") > 0`, `RAISE EXCEPTION`
      с русским текстом и подсказкой `npm run report:dead-tables`
- [ ] `UPDATE "PartnerMembership" SET "roleInPartner" = 'manager' WHERE "roleInPartner" = 'member'`
- [ ] `DROP TABLE "Upload"`, `DROP TABLE "SavedView"`
- [ ] `schema.prisma`: убрать модели + связи `User.savedViews`, `Order.uploads`
- [ ] `prisma:generate`; починить тесты, обращавшиеся к удалённым моделям
- [ ] `npm run gate` — миграция применяется на чистой базе и на базе с данными сида
- [ ] Проверить обе ветки миграции: пустая таблица → проходит; с одной строкой → падает с текстом
- [ ] CHANGELOG

## PR-5 — `У-266`: страж стоп-слов

- [ ] Сборщик пользовательских строк: литералы и JSX-текст из `src/components/{organization,partner,student}-*`
      и клиентских страниц кабинетов заказчика/партнёра/слушателя
- [ ] Список стоп-слов: `externalId`, `companyId`, `organizationId`, `синхронизац`, `Битрикс`,
      `push`, `sync`, коды ошибок латиницей (`forbidden`, `not_found`, …)
- [ ] Список исключений — **с причиной у каждой строки** («Акт из 1С» — пользовательское слово)
- [ ] Починить то, что страж найдёт (перевод на человеческий язык, не подавление)
- [ ] Мутация: вписать `externalId` в текст `partner-*` → страж красный → откатить
- [ ] CHANGELOG

## PR-6 — `У-264` + `У-265`: NOT_DOING и `partner_legacy`

- [ ] `docs/NOT_DOING.md`: таблица из [01 §9](../../specs/01_product_vision.md) — «не делать»,
      причина, дата решения; строка про `partner_legacy` (`Р-Э9-7`); строка про шесть флагов
      «по бизнес-решению» (`В-9-1`)
- [ ] Ссылка из `docs/ARCHITECTURE.md` (карта документации)
- [ ] Ссылка из `CLAUDE.md` §14
- [ ] Страж ссылок образца `docs.live-links` — файл существует, ссылки живые
- [ ] CHANGELOG

## PR-7 — `У-262` (A): кабинетные флаги

- [ ] Снять `organization_cabinet`, `manager_cabinet`, `leader_cabinet`: `FEATURE_FLAGS`,
      `FEATURE_PREFIXES`, поля `flag` в `navigation/cabinet.ts`, все `isFeatureEnabled`/
      `notFoundIfDisabled`/`requireFeature`
- [ ] Удалить тесты ветки «флаг выключен»; добавить тест «страница открывается при пустом env»
- [ ] Матрица флагов: убрать строки, добавить раздел «снятые флаги» с датой и причиной
- [ ] `.env.example` без трёх переменных
- [ ] Страж `security.feature-flags-removed.guardrail.test.ts`: снятые имена не встречаются в `FEATURE_FLAGS`
- [ ] Мутация: вернуть `'manager_cabinet'` → страж красный → откатить
- [ ] CHANGELOG

## PR-8 — `У-262` (B): разделы прежних программ

- [ ] То же для `enrollment_requests`, `client_requests`, `certificates_registry`
- [ ] Тест «открывается при пустом env» для пяти поверхностей каждого
- [ ] Матрица, `.env.example`, страж дополнен тремя именами
- [ ] CHANGELOG

## PR-9 — `У-262` (C): сделки, входящие, хаб настроек

- [ ] То же для `deals_pipeline`, `intake_inbox`, `settings_hub`
- [ ] `settings_hub`: редирект шлюзов 307 → 308 (`Р-Э9-3`, CLAUDE.md §2b); прежние страницы
      «на месте» удаляются вместе с веткой «флаг выключен»
- [ ] CLAUDE.md §2b — поправить абзац про флаг раскатки
- [ ] Матрица, `.env.example`, страж дополнен тремя именами
- [ ] CHANGELOG

## PR-10 — `У-263` + закрытие этапа

- [ ] `introducedAt` в типе `LegacyRoute` + дата у тринадцати шлюзов `settings.ts`
- [ ] Реестр четырёх кабинетных страниц-редиректов (`/organization/students`, `/organization/team`,
      `/manager/students`, `/partner/deals`) с датами — страницы читают реестр
- [ ] Страж `navigation.legacy-gateways.guardrail.test.ts`: у каждого шлюза есть дата; ни один не
      старше 90 дней; «сегодня» подставляется, а не берётся из часов
- [ ] Мутация: сдвинуть дату на 100 дней назад → страж красный → откатить
- [ ] Скрипт-проверка базы на старые пути в ссылках уведомлений (dry-run для будущего удаления)
- [ ] Drift-аудит §16: `AUDIT.md` по `У-259`…`У-267`
- [ ] `STATUS.md`: этап 9 → `✅`, текущий этап → 10
- [ ] CLAUDE.md §14 — снимок состояния
- [ ] Close-out `2026-09-18-stage9-cleanup-DONE.md`
- [ ] CHANGELOG
