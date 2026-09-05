# Этап 9 «Приёмка §0 и закрытие» — план

Спека — [2026-09-05-stage9-acceptance-and-closeout-design.md](../specs/2026-09-05-stage9-acceptance-and-closeout-design.md)
(предъявлена 05.09.2026, docs-PR [#494](https://github.com/aiprocadm/lk_otsfera/pull/494);
**подтверждена 05.09.2026** ответом заказчика «Да»; семь умолчаний §5
действуют). Требования `У-175`, `У-176` действующего
[ТЗ кабинетов, документов и интеграций](../../tz/2026-08-21-tz-cabinets-documents-integrations.md)
плюс расхождение `У-95`/`У-96` (карточка организации у администратора мимо
реестра вкладок — находка `⚠` от 30.08.2026 в AUDIT.md).

REQUIRED SUB-SKILL: superpowers:subagent-driven-development

## Разбивка

| PR | Что | Требования | Статус |
|---|---|---|---|
| PR-1 «Карточка организации у администратора — по реестру» | Ветка Model A в `getOrganizationCard`; страница `/admin/organizations/[id]` на `OrgCardTabs` с `orgCardTabsFor('admin')`; выгрузки «Оплаты»/«Удостоверения» пускают администратора; кнопка выгрузки удостоверений у партнёра и заказчика ведёт на их роуты (попутный `❌`); страж `navigation.org-card-registry-usage.guardrail`; тесты страницы, сервиса, роутов; `⚠` → `✅` в AUDIT | `У-95`, `У-96` (расхождение), §7.3 ТЗ | ✅ [#495](https://github.com/aiprocadm/lk_otsfera/pull/495) (влит 05.09.2026) |
| PR-2 «Глоссарий и приёмка §0» | Словарь в двух местах и страж на 12 терминов; скрипт приёмки `scripts/screen-acceptance.ts` (режим `screens`); обход вкладок карточки в `screen-rules-check.ts`; 12 экранов глазами (`seed=175`); ~30 новых эталонов; починка находок в том же PR | `У-175` | ⏳ |
| PR-3 «Drift-аудит, первый прогон сопровождения, закрытие» | Зона риска и три отметки по 177 строкам (режим `audit` того же скрипта), сводка; `С-1`…`С-10` с датами и журналом; пересъёмка устаревших эталонов; close-out'ы этапа и программы; шапка STATUS, абзац §14 CLAUDE.md, CHANGELOG | `У-176` | ⏳ |

**Порядок обязателен:** PR-1 → PR-2 → PR-3. Приёмка PR-2 должна видеть
окончательную карточку администратора, а аудит PR-3 — код, который больше
не меняется. Хотфиксы, найденные в PR-3 вне файлов этапа, — отдельными PR от
`main` **до** мержа PR-3. Каждый PR открывается от `main` с `base: main`
(§14): следующий ждёт мержа предыдущего.

**Пять решений исполнителя, принятых при написании плана (спеке не
противоречат, но в ней не записаны):**

1. **Кнопки «Выгрузить в Excel» на вкладках «Оплаты» и «Удостоверения» у
   администратора ведут на те же роуты `/api/manager/organizations/[id]/…`,
   а роуты пускают администратора.** Роуты сегодня гейтят
   `isStaffManagerSide` + `canManagerAccessOrg`; администратору это 403 —
   мёртвая дверь, а `OrgCardTabs` зашивает адреса. Заводить зеркальные
   `/api/admin/…` — новая поверхность API ради двух кнопок; прецедент уже
   есть — [api/manager/documents/preview](../../../src/app/api/manager/documents/preview/route.ts)
   со списком `['manager', 'leader', 'admin']`. Правило: роль —
   `session.role === 'admin' || isStaffManagerSide(session)`; скоуп —
   администратору достаточно существования организации (Model A, чужой или
   несуществующий `id` по-прежнему 404), сотрудникам — прежний
   `canManagerAccessOrg`.
2. **Попутный `❌`: у партнёра и заказчика та же кнопка на вкладке
   «Удостоверения» сегодня ведёт на `/api/manager/…` и даёт 403.** Партнёр
   открывает карточку в `/partner/portfolio/[orgId]`, заказчик — в
   `/organization/company`, обе страницы уже на `OrgCardTabs`, у обеих ролей
   есть свои роуты выгрузки (`/api/partner/certificates/export?organization=`,
   `/api/organization/certificates/export?org=`). Компонент получает проп
   `certificatesExport?: { base: string; params?: Record<string, string> }`
   (без пропа — staff-роут, как сейчас), страницы клиентских ролей его
   передают. Чинится в PR-1 по §16 («файл трогает текущий этап»), записывается
   в AUDIT журнальной строкой и в CHANGELOG.
3. **Ссылки на лиды у администратора — текстом.** `LeadsSection` ведёт на
   `/manager/leads/[id]`; у администратора раздела «Лиды» нет (исключение
   зеркала `leads`, кабинет только `manager`), `/manager/*` для него мёртвая
   дверь (Model A). Компонент получает проп
   `leadHref?: ((id: string) => string) | null`: без пропа — прежняя ссылка,
   `null` — тема лида без ссылки. Вкладка «Лиды» у администратора остаётся:
   реестр числит её у всех сотрудников ЦО, §7.3 требует одинаковые вкладки.
4. **Строка «Компания: …» в шапке карточки администратора остаётся.**
   Администратор видит организации всех учебных центров — без названия
   компании не ответить «где я». `OrganizationCard` не расширяется (это
   контракт пяти кабинетов и интеграционного теста); компонент получает проп
   `headerExtra?: React.ReactNode`, страница администратора передаёт строку из
   уже существующего `getOrganizationMeta`.
5. **Скрипт приёмки и скрипт зоны риска — один файл `scripts/screen-acceptance.ts`
   с двумя режимами** (`screens` для §2.2 п. 1, `audit` для §2.5), как сказано
   в спеке; общая часть — разбор `AUDIT.md` и список файлов из `git`. Юнит-
   тесты — на чистые функции разбора и выборки, без запуска `git`.

## PR-1 «Карточка организации у администратора — по реестру» — `У-95`, `У-96`

Ветка `stage9-pr1-admin-org-card` от `main`.

**Сервис карточки (Model A).**

- [x] `src/lib/services/manager/organizationCard.ts`: в цепочке `visible`
      первой веткой `session.role === 'admin' ? true : …` с комментарием
      «Model A: администратор работает через зеркало `/admin/*`, скоуп ему не
      нужен (как `policy.ts`), чужой `id` всё равно 404 — организации нет».
      `teamMode` у администратора остаётся `false` (`companyId` пуст →
      `getCompanyTeamVisibility` вернёт `false`, это уже так).
- [x] `src/__tests__/services.organizationCard.integration.test.ts`: тест
      «admin получает карточку любой организации (Model A), в том числе чужой
      компании; несуществующий `id` → null». Регрессы партнёра и заказчика
      остаются как есть.

**Роуты выгрузок (решение 1).**

- [x] `src/app/api/manager/organizations/[id]/payments/export/route.ts` и
      `…/certificates/export/route.ts`: роль —
      `if (!(session.role === 'admin' || isStaffManagerSide(session))) 403`;
      доступ — `session.role === 'admin' ? !!(await prisma.organization.findUnique({ where: { id }, select: { id: true } })) : await canManagerAccessOrg(prisma, session, id)`,
      иначе 404. Комментарий про Model A в обоих.
- [x] `src/__tests__/api.exports.staff.test.ts` (или соседний тест этих
      роутов): admin → 200 и файл; admin с несуществующим `id` → 404;
      partner/organization → 403 как раньше; `canManagerAccessOrg` для admin
      не вызывается.

**Компонент карточки.**

- [x] `src/components/manager/org-card-tabs.tsx`: три новых пропа —
      `certificatesExport?: { base: string; params?: Record<string, string> }`
      (в `CertificatesSection` вместо зашитого адреса; по умолчанию
      `/api/manager/organizations/${orgId}/certificates/export`),
      `leadHref?: ((id: string) => string) | null` (в `LeadsSection`: `null`
      → `<span>` вместо `<Link>`; по умолчанию `/manager/leads/${id}`),
      `headerExtra?: React.ReactNode` (после строки «Партнёр: …»). Секции
      получают значения пропсами через `renderSection`.
- [x] `src/__tests__/components.org-card-tabs.test.tsx`: кнопка выгрузки
      удостоверений берёт адрес и параметры из `certificatesExport`, без пропа
      — staff-адрес; `leadHref={null}` рисует тему лида текстом, без пропа —
      ссылка на `/manager/leads/<id>`; `headerExtra` виден в шапке.

**Клиентские страницы (решение 2).**

- [x] `src/app/partner/portfolio/[orgId]/page.tsx`:
      `certificatesExport={{ base: '/api/partner/certificates/export', params: { organization: orgId } }}`.
- [x] `src/app/organization/company/page.tsx`:
      `certificatesExport={{ base: '/api/organization/certificates/export', params: { org: card.id } }}`.
- [x] `src/__tests__/pages.partner-org-card.test.tsx` и тест страницы «Моя
      организация»: на вкладке `certificates` href кнопки выгрузки ведёт на
      роут своей роли, а не на `/api/manager/…`.

**Страница администратора.**

- [x] `src/app/admin/organizations/[id]/page.tsx` переписывается по образцу
      [leader/organizations/[id]/page.tsx](../../../src/app/leader/organizations/%5Bid%5D/page.tsx):
      `requireAdmin()` → `visibleTabs = orgCardTabsFor('admin', { flags: isFeatureEnabled })`
      → `activeTab` из `?tab=` (чужой ключ → `overview`) →
      `getOrganizationCard(prisma, session, id)` → `notFound()` при `null`.
      Данные по вкладкам: `employees` → `listOrgCardEmployees` (q/skip, take
      25); `documents` → `listOrganizationProposals(prisma, session, { organizationId: id })`;
      `settings` → `getOrganization` (для `OrganizationEditForm`),
      `getOrgRequisitesByAdmin`, `listOrgRateHistory`, `getFieldsForEntity`.
      Всегда: `getOrganizationMeta` (строка «Компания») и
      `getAutoCreatedFrom1C`.
      Разметка: `Breadcrumbs` (`buildCabinetBreadcrumbs('admin', '/admin/organizations', [{ label: card.name }])`)
      → `AutoCreatedBadge` → `OrgCardTabs` с `headerExtra` («Компания: …»),
      `egrulAction={<EgrulFillDialog …/>}`,
      `documentsAction={isFeatureEnabled('document_generation') ? <IssueOrderLessDocumentButton organizationId={id} /> : null}`,
      `proposals={<ProposalsBlock rows hrefBase="/admin/documents" />}`,
      `leadHref={null}`, `employees={<OrgEmployeesSection basePath={`/admin/organizations/${id}`} …/>}`,
      `settings={<OrgSettingsTab cabinet="admin" slots={…прежние пять слотов…} />}`.
      Плитки ИНН/КПП, 1С ID, «Объёмы» и плоские секции уходят: их место —
      плитки реестра и вкладки. Комментарий про «плоскую карточку» убирается.
- [x] `src/__tests__/pages.admin-organizations-id.test.tsx` переписывается:
      без `?tab` — вкладка «Обзор», `orgCardTabsFor` вызван с `'admin'`;
      `?tab=settings` — форма организации, реквизиты, доступ в кабинет,
      менеджеры, ставка, доп. поля; `?tab=documents` — кнопка выпуска без
      заказа и блок КП с `hrefBase="/admin/documents"`; `?tab=employees` —
      `listOrgCardEmployees` вызван с `q`/`skip`; чужой `?tab=xyz` → «Обзор»;
      `getOrganizationCard` вернул `null` → `notFound`; строка «Компания: …»
      в шапке; на вкладке «Обзор» сервисы настроек не вызываются.
- [x] `src/e2e/snapshots/admin-organizations-edit.spec.ts`: второй тест
      открывает `detailHref + '?tab=settings'` (блок ставки теперь на вкладке
      «Настройки»); эталон пересъёмка в PR-2 (§2.3 спеки).

**Страж реестра.**

- [x] `src/__tests__/navigation.org-card-registry-usage.guardrail.test.ts`:
      карта «кабинет → страница карточки» (`admin` →
      `src/app/admin/organizations/[id]/page.tsx`, `leader` →
      `src/app/leader/organizations/[id]/page.tsx`, `manager` →
      `src/app/manager/organizations/[id]/page.tsx`, `partner` →
      `src/app/partner/portfolio/[orgId]/page.tsx`, `organization` →
      `src/app/organization/company/page.tsx`). Тесты: (1) каждый кабинет из
      объединения `ORG_CARD_TABS[*].cabinets` есть в карте — новый кабинет в
      реестре без страницы падает; (2) исходник каждой страницы содержит
      `orgCardTabsFor('<кабинет>'` и `<OrgCardTabs`; (3) ни одна из пяти
      страниц не зовёт `orgCardTabsFor` с чужим кабинетом.
- [x] Мутация: подменить кабинет в вызове `orgCardTabsFor('admin', {` на
      странице администратора — страж падает (два теста); вернуть. Страж
      читает исходник без комментариев: упоминание в docstring вызовом не
      считается (проверено второй мутацией — только по коду).

**Гейты, документы, PR.**

- [x] `npm run typecheck` · `npm run lint` · `npm run dup:check` ·
      `npm run boundaries` · `npm run deadcode` (долг `main` не растёт).
- [x] Unit затронутых файлов, затем полный `npm run test:unit` через
      `nohup … & disown`; integration
      `npx vitest run --mode=integration src/__tests__/services.organizationCard.integration.test.ts`.
      Полный прогон вскрыл два стража, знавших про плоскую карточку:
      `navigation.without-inn-filter.guardrail` искал плашку «ИНН не указан»
      в странице админа (теперь её рисует общий компонент — проверка
      переписана), а `documents.superseded-versions.guardrail` вырезает
      комментарии регулярным выражением и принял `` `/admin/*` `` в моём
      комментарии за начало блочного комментария — слово в комментарии
      заменено, страж не трогался.
- [x] `docs/tz/AUDIT.md`: строки `У-95`/`У-96` — якорь страницы
      администратора и дата; находка «карточка администратора мимо реестра»
      из раздела «Вне объёма» помечена закрытой (как строка про вложения
      чата — зачёркнуто + «✅ ЗАКРЫТО»), сводка `⚠ 2` → `⚠ 1`; попутный
      `❌` кнопки выгрузки у партнёра/заказчика записан там же. Сверх плана:
      `У-101` («у администратора карточка переводится на вкладки того же
      реестра») стояло `⚠ частично` с 23.08.2026 — этот PR закрывает его
      остаток, вердикт → `✅`, сводка `✅ 174` → `175`; строка `У-145` —
      «блок у администратора» заменён слотом `documentsAction`.
- [x] `CHANGELOG.md`, `docs/tz/STATUS.md` (строка этапа 9, журнал).
- [x] PR `base: main`, дождаться `mergeStateStatus=CLEAN`, влить
      `--squash --delete-branch`, проверить
      `git cat-file -e origin/main:src/__tests__/navigation.org-card-registry-usage.guardrail.test.ts`.

## PR-2 «Глоссарий и приёмка §0» — `У-175`

Ветка `stage9-pr2-glossary-acceptance` от `main` после мержа PR-1.

**Глоссарий (§2.4).**

- [x] `docs/glossary.md`: термин «Моя организация» (раздел заказчика с
      вкладками «Сотрудники», «Команда», реквизиты — `Р-12`); формулировки
      пяти остальных («Каталог услуг и цены», «Строка заказа», «Коммерческое
      предложение», «Доступ в кабинет», «Выгрузка в 1С») сверяются с
      подзаголовками экранов.
- [x] `src/lib/help/glossary.ts`: раздел `{ id: 'catalog-documents-access', title: 'Каталог, документы и доступ', … }`
      с шестью терминами (`term`, `meaning`, `notThis`); `REQUIRED_TERMS`
      — двенадцать слов.
- [x] `src/__tests__/help.glossary.guardrail.test.ts`: тесты проходят по
      всем двенадцати в `GLOSSARY` и в `docs/glossary.md`; мутация — убрать
      «Моя организация» из `docs/glossary.md` — страж падает; вернуть.

**Скрипт приёмки (§2.2 п. 1, решение 5).**

- [x] `scripts/screen-acceptance.ts`, режим `screens`: список
      `git diff --name-status 92c683e main -- 'src/app/**/page.tsx'` →
      по каждому файлу цепочка «страница + импортированные компоненты из
      `src/components/**`»: `h1`/`PageHeader` с русским текстом ·
      подзаголовок (`subtitle=`) либо файл в списке карточек-исключений
      стража понятности · главная кнопка (`Button`/`Link`-кнопка/форма) либо
      `EmptyState`. Вывод — markdown-таблица «кабинет → экранов → где я / что
      здесь / что дальше» и список экранов с пробелами.
- [x] `src/lib/acceptance/screenRules.ts` (чистые функции: разбор исходника
      на признаки, детерминированная выборка `pickSample(files, n, seed)`)
      и `src/__tests__/acceptance.screen-rules.test.ts`: признаки на трёх
      фикстурах-строках; `pickSample(list, 12, 175)` дважды → один список,
      по два на кабинет.
- [x] Прогон скрипта по `main`; каждый экран с пробелом чинится в этом же PR
      (подзаголовок / кнопка / `EmptyState`).

**Живой обход с вкладками карточки (§2.2 п. 2).**

- [x] `src/e2e/screen-rules-check.ts` (или его спека): после статических
      адресов — для каждого кабинета список организаций → первая строка →
      все вкладки `orgCardTabsFor(кабинет)` (заказчик — «Моя организация»,
      партнёр — портфель); проверки: ширина ≤ 390, один `h1`, подзаголовок,
      «подпись активной вкладки = `label` реестра»; пропуск (нет данных /
      флага) — строка «ПРОПУЩЕН» в лог.
- [x] Стенд: отдельная seed-база + `next dev` на `:3100`
      (`LD_LIBRARY_PATH=/home/aiproc/.local/pw-libs/root/usr/lib/x86_64-linux-gnu`),
      обход зелёный, лог сохранён в close-out.

**Выборка глазами и эталоны (§2.2 п. 3, §2.3).**

- [x] 12 экранов из `pickSample(новые 42, 12, 175)` открываются на 390×844 и
      на десктопе; таблица «экран → где я → что здесь → что дальше → что
      поправлено» — в close-out этапа; найденное чинится здесь же.
- [x] Новые спеки эталонов в `src/e2e/snapshots/`: `leader-documents`,
      `leader-messages`, `leader-settings-integrations`,
      `leader-settings-price-list`, `admin-1c-documents`,
      `admin-document-templates`, `manager-exchange`, `organization-company`,
      `partner-order-card` (первый seed-заказ), пересъёмка
      `admin-organization-edit`; маски дат — как у соседей; каждый тремя
      проектами; две сверки подряд без диффов.
- [x] Таблица 26 исключений зеркала из `mirrorExceptions.ts` с причинами —
      в close-out этапа (§7.4 ТЗ). Новых исключений не добавлять.
      *(По факту исключений 28 — таблица в close-out; эталоны сняты двумя
      проектами на кабинет — в `playwright.config.ts` третьего нет.)*

**Гейты, документы, PR.**

- [x] `typecheck` · `lint` · `dup:check` · `boundaries` · `deadcode`; unit
      затронутых и полный `test:unit` через `nohup`; `docs.tz-program`.
- [x] `docs/tz/AUDIT.md`: `У-175` → `✅` с якорями (глоссарий, скрипт,
      обход, эталоны) и датой; сводка ⏳ 2 → 1.
- [x] `CHANGELOG.md`, `docs/tz/STATUS.md`; PR `base: main`, влить, проверить
      `git cat-file -e origin/main:scripts/screen-acceptance.ts`.

## PR-3 «Drift-аудит, первый прогон сопровождения, закрытие» — `У-176`

Ветка `stage9-pr3-audit-and-closeout` от `main` после мержа PR-2.

**Зона риска (§2.5).**

- [ ] `scripts/screen-acceptance.ts`, режим `audit`: разбор строк `AUDIT.md`
      (номер, дата сверки, ссылки-якоря) → для каждой строки
      `git log --since=<дата> --name-only -- <якоря>`; вывод — три группы:
      «страж» (якорь — тест `*.guardrail.test.ts` или строка ссылается на
      него), «якорь не менялся с DD.MM», «менялся — руками». Разбор строк —
      в `src/lib/acceptance/auditRegistry.ts` с юнит-тестом на трёх
      фикстурах-строках.
- [ ] Прогон; группа «руками» проходится по колонке «Что проверять» строка
      за строкой; каждая из 177 строк получает ровно одну отметку в колонке
      «Сверено» (`страж, прогон 0N.09.2026` / `якорь не менялся с DD.MM` /
      `проверено руками 0N.09.2026`).
- [ ] `❌` — по §16: файл этапа — здесь, иначе хотфикс-PR от `main` со
      стражем и мутацией **до** мержа PR-3. Сводка: ожидаемо ✅ 176 / ⏳ 0 /
      ❌ 0 / ⚠ 1 («287 маршрутов» в тексте ТЗ понятности остаётся).

**Первый прогон `С-1`…`С-10` (§2.6).**

- [ ] `С-1` гейты: `typecheck` · `lint` · `test:unit` · `boundaries` ·
      `deadcode` · `dup:check` · `npx vitest run --mode=integration` против
      живого Postgres (без `gate` — Docker на сервере нет; так и записать).
- [ ] `С-2` drift-аудит — ссылка на §2.5 выше.
- [ ] `С-3` живой обход — прогон `screen-rules-check` с вкладками (PR-2) на
      стенде `:3100`.
- [ ] `С-4`…`С-8` — по процедурам `MAINTENANCE.md` дословно.
- [ ] `С-5` мутация стражей — первые десять из 58 `*.guardrail.test.ts` по
      алфавиту; список — в реестр.
- [ ] `С-9` зависимости — `npm audit` (production и полный); мажор с
      уязвимостью — `⚠`.
- [ ] `С-10` эталоны — `npm run e2e:visual` на стенде; устаревшие эталоны
      этапов 4–8 пересъёмка **с пояснением по каждому экрану** (что
      сдвинулось и почему ожидаемо); две сверки подряд.
- [ ] Журнал `MAINTENANCE.md`: каждая находка с вердиктом; `❌` — не более
      трёх хотфикс-PR, остальное — очередь; `⚠` — вопросы заказчику в
      STATUS.md. Строки `С-1`…`С-10`: дата, короткий хеш `main`, итог.

**Закрытие (§2.7).**

- [ ] `docs/superpowers/plans/2026-09-05-stage9-acceptance-and-closeout-DONE.md`:
      таблицы приёмки (скрипт, обход, глаза), 26 исключений зеркала, итоги
      прогона, что не вошло.
- [ ] `docs/tz/2026-09-XX-tz-cabinets-program-DONE.md` (дата мержа PR-3) по
      образцу [2026-07-28-tz-program-DONE.md](../../tz/2026-07-28-tz-program-DONE.md):
      этапы 0–9, PR #401…, блоки J…R, дефекты `Д-1`…`Д-40` со ссылками на
      стражей, чему научила программа.
- [ ] `docs/tz/STATUS.md`: шапка «Текущий этап: **программа завершена —
      режим сопровождения** (последний прогон `С-N`, дата)»; таблица вся
      `✅`; журнал. Четыре указателя на ТЗ **не меняются**.
- [ ] `CLAUDE.md` §14: абзац «Состояние на …» — программа закрыта, режим
      сопровождения. `docs/tz/AUDIT.md`: строка состояния в шапке, `У-176`
      → `✅`, сводка. `docs/ARCHITECTURE.md` — только если карта документации
      ссылается на этап.
- [ ] `docs.tz-program` зелёный; `CHANGELOG.md`; PR `base: main`, влить,
      проверить `git cat-file -e origin/main:docs/superpowers/plans/2026-09-05-stage9-acceptance-and-closeout-DONE.md`.
