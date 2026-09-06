# Реестр проверок сопровождения — что делать по «продолжай по ТЗ», когда этапов нет

Заведён 21.08.2026 требованием `У-80` ТЗ
[2026-08-21-tz-cabinets-documents-integrations.md](2026-08-21-tz-cabinets-documents-integrations.md)
(§9). Протокол — `CLAUDE.md` §14, блок «Режим сопровождения». Прогресс по
этапам — [STATUS.md](STATUS.md), сверка требований — [AUDIT.md](AUDIT.md).

**Зачем этот файл.** Между программами код никто не проверял: по фразе
«продолжай по ТЗ» агент отвечал «работы нет» и ждал. За это время накопились
дефекты `Д-1`…`Д-40` (§3.6 ТЗ) — все гейты зелёные, а счёт печатает
«В том числе НДС.» без суммы. Теперь «работы нет» означает **«выбери самую
старую проверку из таблицы и выполни её»**.

## Как пользоваться

1. **Когда.** Только если в `STATUS.md` нет этапов без `✅` и `gh pr list
   --state open` пуст. Пока есть открытый этап — работа идёт по нему, а не
   по этому файлу.
2. **Что выбрать.** Проверку с самой старой датой в колонке «Последний
   прогон». «Не выполнялась» старше любой даты. При равенстве — меньший номер.
3. **Что записать.** После прогона: дату, короткий хеш коммита `main`, на
   котором проверяли, итог одной строкой и ссылки на хотфикс-PR. Каждая
   находка — строка в «Журнале находок» с вердиктом `❌ дефект` · `⚠ вне
   объёма` · `ℹ шум`.
4. **Сколько чинить.** Не более трёх хотфикс-PR за прогон; остальное остаётся
   в очереди журнала и берётся следующим прогоном первым. Один дефект — один
   PR — один тест-страж, проверенный мутацией (`CLAUDE.md` §16).
5. **Чего не делать.** Границы режима — §9.4 ТЗ: никаких новых экранов,
   сущностей, миграций схемы (кроме индексов и ограничений целостности),
   правок требований, ослабления гейтов, массовых рефакторингов, мажорных
   обновлений. Нашёл такое — это `⚠`, вопрос заказчику, а не PR.

## Проверки

| № | Проверка | Процедура | Последний прогон | Итог |
|---|---|---|---|---|
| С-1 | **Гейты** | `npm run typecheck` · `npm run lint` · `npm run test:unit` · `npm run boundaries` · `npm run deadcode` · `npm run dup:check`; при доступном Docker — `npm run gate`. Любой красный — `❌` | 05.09.2026, `b9d94408` | ✅ с оговоркой — на `12c3078a`: typecheck 0 · lint 0 · boundaries 0 · dup:check 2,61 % (465 клонов) · deadcode ❌ новый мёртвый экспорт `BOARD_CAP` (след [#507](https://github.com/aiprocadm/lk_otsfera/pull/507)) → хотфикс №8 [#508](https://github.com/aiprocadm/lk_otsfera/pull/508), после него knip = известный долг `main` (1 файл / 5 экспортов / 19 типов / 1 дубль); на `bc821b94` (код #507; хотфикс №8 менял только тест и документы): unit ✅ 1099 файлов / 11 892 тестов (1 файл и 3 теста пропущены), 10,2 мин · integration ✅ 182 / 1382, 2,5 мин · `next build` ✅. `gate` по-прежнему невозможен: Docker нет |
| С-2 | **Drift-аудит ТЗ** | Полный проход `CLAUDE.md` §16 по всем `У-N` (закрытые программы тоже — они описывают ожидаемое поведение): проверять цепочку поведения, не наличие файла. Обновить [AUDIT.md](AUDIT.md) | 05.09.2026, `b9d94408` | ✅ — с `c9e25e31` в `src` менялись 20 файлов; якоря затронуты у трёх строк (`У-124`, `У-129`, `У-133` — замена тихого `.catch` на `bestEffort` по `Р-25`, цепочка «страница → сервис → тест» прежняя, тесты роутов дополнены); доски `Р-27` своих номеров `У-N` не имеют (`У-166` — конверсия на `/leader/analytics`, не доска); остальные 174 строки не тронуты — править нечего |
| С-3 | **Живой обход §0** | По реестру меню (`lib/navigation/cabinet.ts`) и реестру вкладок карточки: заголовок = пункт меню, подзаголовок в одну строку, главная кнопка или пустой экран с кнопкой, крошки на вложенных, ширина ≤ 390 px без горизонтального скролла, ошибки на русском. Образец процедуры — записи 20–21.08.2026 в [AUDIT.md](AUDIT.md) | 05.09.2026, `b9d94408` | ✅ — обход шести кабинетов (`screen-rules-check`, `mobile-shell-check`: заголовок = пункт меню, вкладки карточки, каркас на 390 px) в полном прогоне Playwright против свежего стенда `:3100` на `b9d94408` без замечаний; доски после `Р-27` (`/manager|leader/funnel|deals|tasks`) на 390 px — 6 из 6; инфраструктурных падений 0 |
| С-4 | **Доступ и изоляция** | Прогнать `security.role-access-matrix.guardrail`; для роутов и сервисов, появившихся с прошлого прогона, — ручные IDOR-пробы (чужая организация, чужая компания, чужой партнёр, `teamMode`, `canSee*`); убедиться, что у новых страниц кабинетов есть серверный `canSee*` (§4 `CLAUDE.md`) | 05.09.2026, `b9d94408` | ✅ — 22 security-файла (14 unit + 8 integration) / 152 теста зелёные; новых роутов и страниц нет; новые `count` досок и справочников (`Р-27`) идут по тому же `where`, что их `findMany` (`dealScopeWhere`, `leadWhereForLevel`, `taskFiltersWhere`, `companyId` с сентинелом), клиентские роли получают пустую доску без запросов — закреплено `boards.cap-and-order.unit` |
| С-5 | **Мутация стражей** | По кругу: взять следующие 5–10 тестов-стражей (`*.guardrail.test.ts` и стражи из `AUDIT.md`), сломать инвариант, убедиться, что тест падает, вернуть файл. Молчащий страж — `❌`. Вести список проверенных стражей ниже, чтобы круг не начинался заново | 05.09.2026, `b9d94408` | ✅ 10 из 10 — стражи после `featureFlags.third-gate`: `help.glossary`, `import.no-second-writer`, `import.org-name-key`, `navigation.breadcrumbs-coverage`, `navigation.icons`, `navigation.menu-groups`, `navigation.mirror`, `navigation.org-card-registry-usage`, `navigation.org-card-tabs`, `navigation.org-card-tiles`; 11 поломок пойманы (две пробы вне инварианта стражи не ловят, их закрывают `tsc` и соседний страж — ℹ); плюс 9 мутаций `Р-27` и 3 хотфикса №8. Следующий круг — с `navigation.org-settings-sections` |
| С-6 | **Молчаливые ошибки** | `grep`/AST по `src/**` (кроме тестов): пустые `catch {}` и `.catch(() => {})` без `log`; `as unknown as`; `!` без комментария-обоснования; `TODO`/`FIXME`/`HACK`; `take:` без пагинации и счётчика; `process.env.` вне списка `У-122`; `console.*`; `revalidatePath`, не покрывающий все экраны объекта; свежие дубли `jscpd` | 05.09.2026, `b9d94408` | ℹ — тихие `catch`: 3 в allow-list стража `errors.no-silent-catch` и 6 `.catch(() => undefined)` в `src/e2e/screen-rules-check.ts` (Playwright-обход, вне охвата стража) — шум; `TODO`/`FIXME` 0; `console.*` только в комментарии `oneCSync/push.ts`; новых `process.env` нет; новые `take` — через константы со счётчиками (`Р-27`); `as unknown as` только в тестах |
| С-7 | **Документация ↔ код** | `.env.example` и `.env.production.example` против `process.env` в коде; `docs/integrations/1c-contract.md` против `schemas.ts`/`rest-wire.ts`/`mock-1c`; `docs/glossary.md` против строк меню и вкладок; `CHANGELOG.md` за последние PR; команды README против `package.json`; `docs/feature-flags-matrix.md` против `featureFlags.ts` | 05.09.2026, `b9d94408` | ✅ — `.env.*` под стражем `У-134`, новых `process.env` нет; `1c-contract.md` привязан к `oneCSync.schemas.test`; CHANGELOG за #505–#508 на месте, версия 0.10.0 / `[Unreleased]`; стражи команд, флагов и глоссария зелёные в полном unit; доски в `docs/*.md` описаны только общо (`glossary.md`, `ARCHITECTURE.md`) — с `Р-27` не расходятся |
| С-8 | **Производительность** | Поиск `findMany`/`findFirst`/`count` внутри циклов (N+1); новые `where`/`orderBy` без индекса в `schema.prisma`; списки без `take` и без пагинации; тесты дольше 5 с (`vitest --reporter=verbose`) | 05.09.2026, `b9d94408` | ℹ — новые `orderBy [status, createdAt]` досок ложатся на индексы `[companyId, status]` (Deal, Task) и `[partnerId, status]`/`[assignedManagerId]` (Lead), `count` — по ним же; справочник организаций диалога задачи сортируется по `updatedAt` внутри `companyId` без составного индекса (запись в журнале); циклов с запросами не добавилось; файлов unit дольше 5 с — 0, самый долгий `services.exports-renderers.unit` 3,8 с |
| С-9 | **Зависимости** | `npm audit --omit=dev` и `npm audit`; открытые PR renovate; уязвимые версии. Патч/минор с уязвимостью — чинить; мажор — только спекой (`⚠`) | 05.09.2026, `b9d94408` | ✅ — `npm audit --omit=dev` = 0; `npm audit` = 6 — тот же dev-хвост (`vitest`, `vite`, `vite-node`, `@vitest/mocker`, `@vitest/coverage-v8`, `esbuild`), принятый риск `Р-26`; PR ботов нет |
| С-10 | **Визуальные эталоны** | При доступном стенде (`npm run dev` + seed): `npm run e2e:visual`, включая проекты `mobile-*`. Красные **не по картинке** — `❌`; устаревшие эталоны — пересъёмка с объяснением в PR, что именно сдвинулось и почему это ожидаемо | 05.09.2026, `b9d94408` | ✅ — полный прогон 480 проверок (13 проектов): 275 выполнены, 205 пропущены штатно, падений 0, диффов по картинке 0, 30 мин; досок в эталонах нет (снимаются дашборды и карточки), подпись `ListCapNotice` на стенде и не появилась бы — карточек меньше 500; пересъёмка не понадобилась |

## Журнал находок

Одна строка на находку. Вердикт ставится сразу (`❌ дефект` · `⚠ вне объёма` ·
`ℹ шум`); `✅` в колонке «Закрыто» — только после мержа хотфикса в `main`.

> Дефекты `Д-1`…`Д-40`, найденные аудитом 21.08.2026 при заведении ТЗ, сюда
> **не** записаны: они закрываются этапами 1–8 программы (у каждого указано
> требование `У-N` в §3.6 ТЗ), а не сопровождением. Режим сопровождения
> начинается, когда этапов не останется.

| Дата | Проверка | Находка | Вердикт | Закрыто |
|---|---|---|---|---|
| 05.09.2026 | С-5 | Страж `components.upload-size-hint.guardrail` ловит только однострочную подсказку «Максимум 200 МБ.»; при переносе prettier (`Максимум 200{' '}` + новая строка + `МБ.`) поломка цифры проходит (2 passed) | ❌ дефект | ✅ хотфикс №2 — #499 (сверка файла целиком, 4 мутации пойманы) |
| 05.09.2026 | С-7 | `docs/feature-flags-matrix.md` описывает 19 флагов, в `featureFlags.ts` их 30: нет `leader_analytics`, `contacts`, `staff_chat`, `staff_calendar`, `global_search`, `client_requests` и др.; стража «документ ↔ реестр» нет | ❌ дефект | ✅ хотфикс №1 — #498 (страж `docs.feature-flags-matrix`, 5 мутаций пойманы) |
| 05.09.2026 | С-9 | `npm audit --omit=dev`: 14 уязвимостей (next 15.5.22, sharp 0.34.5, mailparser, nanoid, ip-address, fast-uri, browserslist, html-to-text, js-yaml, brace-expansion, postcss-selector-parser) — все чинятся патч/минор-обновлением без `--force` | ❌ дефект | ✅ хотфикс №3 — #500 (`npm audit fix` без `--force`: 14 → 7, только lock-файл; остаток — мажоры/откат, В-2) |
| 05.09.2026 | С-6 | Запись аудита `recordAudit(...).catch(() => {})` без `log` в потоке входа: `api/auth/login/route.ts:169`, `api/auth/2fa/verify/route.ts:70,94`, `api/auth/2fa/resend/route.ts:88`, `server-actions/staff/backupCodes.ts:25`, `lib/services/auth/sessions.ts:30`; там же `writeSyncLog(...).catch(() => {})` в `worker/processors/mango-backfill.ts:111`. Проглатывать нужно (вход не должен ломаться), но молча — нет: образец `.catch((e) => log.warn(...))` в `dlq/retry-all/route.ts:34` | ❌ дефект | ✅ решение `Р-25` (по поручению заказчика, 05.09.2026) — PR [#505](https://github.com/aiprocadm/lk_otsfera/pull/505): микро-спека, хелпер `bestEffort(label)` → `log.warn`, 8 мест + 2 `.catch(() => undefined)` в `clientRequests/attachments.ts`; страж `errors.no-silent-catch.guardrail`, 6 мутаций пойманы |
| 05.09.2026 | С-6 | Списки усекаются без счётчика «показано N из M»: `services/documents/generalList.ts:24` (`take: 200`), `services/commission/corrections.ts:139` (200), `services/admin/pendingRecords.ts:52` (100) | ❌ дефект | ✅ хотфикс №4 — [#501](https://github.com/aiprocadm/lk_otsfera/pull/501) (прогон №2; сервисы отдают `total`, примитив `ListCapNotice`, 8 мутаций пойманы) |
| 05.09.2026 | С-6 | `/partner/finance` показывает 30 последних комиссионных отчётов (`app/partner/finance/page.tsx`, `listStatements(…, { take: 30 })`) без подписи и без пути к остальным — старые только в выгрузке Excel; у сервиса уже есть `skip`/`take`, примитив `Paginator` есть | ❌ дефект | ✅ хотфикс №5 — [#502](https://github.com/aiprocadm/lk_otsfera/pull/502) (прогон №2; `countStatements` по общему `statementsWhere`, `Paginator` на странице, 5 мутаций пойманы) |
| 05.09.2026 | С-6 | Доски сделок / воронки / задач (`deals/board.ts:76`, `funnel/board.ts`, `tasks/board.ts:133`) берут 500 новейших карточек **включая закрытые и выполненные** и молчат; при переполнении старые «живые» карточки исчезнут с доски. Диалог задачи (`tasks/board.ts:198`, `task-dialog.tsx:155`) — селекты организаций (200 по алфавиту) и заявок (100 новейших) без поиска | ⚠ вне объёма | ✅ решение `Р-27` (по поручению заказчика, 05.09.2026) — PR [#507](https://github.com/aiprocadm/lk_otsfera/pull/507): доски сортируют `status asc, createdAt desc` (терминальные значения enum последними — в предел 500 первыми попадают открытые), рядом честный `count` и подпись «Показаны первые N из M» на 6 страницах; справочники диалога задачи — по последней активности со счётчиком, текущая привязка не теряется. Стражи `prisma.enum-terminal-last.guardrail` и `boards.status-order.integration`, 9 мутаций пойманы. Комбобокс с поиском — отдельная спека по запросу |
| 05.09.2026 | С-6 | Прочие `take` без счётчика ограничены самой моделью: `admin/alerts.ts:39` (100, ключ = правило), `deals/notes.ts:73` (200 на сделку), `manager/orderDetail.ts:39` (50 записей аудита), `staffChat/mentions.ts:59` (200), `calendar/items.ts` (окно дат), точечные `take: 1/2/5`; `api/enrollments/students` отдаёт свой предел в `meta.take` | ℹ шум | — |
| 05.09.2026 | С-7 | Рабочие чеклисты зовут несуществующее: `npm run worker:start` в `docs/qa-staging-smoke-manager.md:23`, `docs/qa-staging-smoke-organization.md:19`, `docs/runbook-staged-rollout-cabinets.md:65` (в `package.json` — `worker`); `dist/scripts/backfill-order-organization-id.js` в `qa-staging-smoke-organization.md:18` — скрипт удалён после миграции `NOT NULL` | ❌ дефект | ✅ хотфикс №6 — [#503](https://github.com/aiprocadm/lk_otsfera/pull/503) (прогон №2; команда поправлена, шаг бэкфилла заменён пояснением, страж `docs.commands-exist.guardrail`, 3 мутации пойманы) |
| 05.09.2026 | С-7 | В документе заказчика `docs/tz/2026-08-04-tz-fix-1c-import.md` скрипты названы `.mjs` (`inspect-1c-xlsx`, `backfill-orphan-companies`), реализованы как `.ts`; `npm run report:legacy-enrollments` в ТЗ/AUDIT/STATUS — одноразовый отчёт `У-34а`, снят после разбора (`ab2a0ae6`). Документы заказчика и реестры не правятся — страж их не сканирует | ℹ шум | — |
| 05.09.2026 | С-9 | Мажорные обновления: `next` 15.5 → 16.3.4, `vitest` 4 → 5; у `prisma`/`exceljs` у `npm audit` нет фикса, только откат | ⚠ вне объёма | ✅ решение `Р-26` (по поручению заказчика, 05.09.2026) — хотфикс №7 PR [#506](https://github.com/aiprocadm/lk_otsfera/pull/506): дырявы были транзитивные `postcss@8.4.31`/`uuid@8.3.2`/`deepmerge-ts@7.1.5`, а не сами пакеты; `overrides` в `package.json`, `npm audit --omit=dev` = 0; мажоры не тронуты. Dev-хвост (`vitest`/`vite`/`esbuild`, 6 записей) — принятый риск, пересмотр на каждом `С-9`; страж `deps.overrides.guardrail`, 3 мутации пойманы |
| 05.09.2026 | С-6 | `Sentry.flush(2000).catch(() => {})` при аварийном выходе воркера; `twoFactorChallenge.delete(...).catch` (челлендж уже мог истечь); `recordLastLogin` (комментарий объясняет); 13 × `as unknown as` и 112 × `!` — все с обоснованием | ℹ шум | — |
| 05.09.2026 | С-8 | Циклы с запросами: `oneCSync/corrections.ts:38`, `oneCSync/invoicePaidNotice.ts:58`, `import/matcher.ts:41`, `oneCSync/reconcile.ts:164` — наборы ограничены (строки одной выписки, документы одного заказа) | ℹ шум | — |
| 05.09.2026 | С-1 | `npm run deadcode` (knip) на `12c3078a`: новый мёртвый экспорт `BOARD_CAP` в `services/deals/board.ts:76` — след PR [#507](https://github.com/aiprocadm/lk_otsfera/pull/507): тест доски сделок проверял `take: 500` числом, а не константой (у воронки и задач константа импортирована тестом `boards.cap-and-order.unit`) | ❌ дефект | ✅ хотфикс №8 — [#508](https://github.com/aiprocadm/lk_otsfera/pull/508) (прогон №3; тест `services.deals.board` импортирует `BOARD_CAP`, проверяет `take` и само значение; knip снова 5 экспортов = известный долг; 3 мутации пойманы) |
| 05.09.2026 | С-5 | `navigation.breadcrumbs-coverage` не замечает переименование пропа `breadcrumbs=` на странице (вьюха всё равно рендерит `<Breadcrumbs>`), фолбэк `menuGroupRank → 0` не ловится никем (ветка недостижима — чужие группы запрещает сам страж) | ℹ шум | — (чужой проп ловит `tsc`, мутацию во вьюхе страж поймал) |
| 05.09.2026 | С-6 | Шесть `.catch(() => undefined)` в `src/e2e/screen-rules-check.ts` — обход экранов Playwright глотает ошибки проб нарочно, вне охвата стража `errors.no-silent-catch` (`src/**` без e2e) | ℹ шум | — |
| 05.09.2026 | С-8 | Справочник организаций диалога задачи (`getTaskFormOptions`, `Р-27`) сортируется по `updatedAt` внутри `companyId` без составного индекса `[companyId, updatedAt]` — Postgres сортирует организации компании в памяти | ℹ шум | — (сотни–тысячи строк сортируются за миллисекунды; индекс = миграция, §9.4 — вернуться, если у компании станет больше ~10 000 организаций) |
| 05.09.2026 | С-10 | Доски сделок/воронки/задач не входят в визуальные эталоны (`src/e2e/snapshots/` снимает дашборды и карточки); после `Р-27` их держат обход §0 (`С-3`, 6 из 6 на 390 px) и unit-тесты страниц | ℹ шум | — (новый эталон — не хотфикс; при следующей пересъёмке эталонов добавить доски) |
| 05.09.2026 | С-1 | `npm run gate` не запустить: на сервере нет Docker; integration-слой прогнан напрямую против живого Postgres (`lk_otsfera_e2e`) | ℹ шум | — |
| 05.09.2026 | С-3, С-10 | Dev-сервер стенда `:3100` (`next dev`) через ~3 ч работы упал с `JavaScript heap out of memory` (heap 19 ГБ): 74 проверки получили `ERR_CONNECTION_REFUSED`. После перезапуска `--last-failed` 80/80 зелёные, диффов по картинке нет. Перед полным прогоном стенд перезапускать; при повторе — стенд на `next build && next start` | ℹ шум | — |
| 05.09.2026 | С-10 | `organization-team-modal-focus-trap` › «background is inert» на `mobile-organization`: `dialog[open] input[name=email]` не найден после клика (клик до гидратации в dev-режиме); соседний тест с тем же кликом прошёл, перегон прошёл | ℹ шум | — |
| 06.09.2026 | С-5 | Страж `navigation.page-title-matches-menu.guardrail` молчит: читает только буквальные `<h1>`, а 89 страниц разделов ставят заголовок через `<PageHeader title=…>` — заголовков он не находил и проходил вхолостую (мутация «Заказы» → «Заявки» в `manager/orders/page.tsx` не поймана) | ❌ дефект | ✅ хотфикс №9 — [#510](https://github.com/aiprocadm/lk_otsfera/pull/510) (прогон №4; страж читает `title="…"`, `title={'…'}`, `title={sectionLabel('…')}` — 69 из 89 разделов, и падает, если прочитал меньше 50; 3 мутации пойманы) |

| 06.09.2026 | С-6 | Карточка организации (`services/manager/organizationCard.ts`): 12 вкладок-списков по `take: 20` без счётчика и подписи — во всех пяти кабинетах; плитка «Задолженность» (`У-102`) считалась `reduce` по показанным 20 заказам, а не по всем | ❌ дефект | ✅ хотфикс №10 — [#511](https://github.com/aiprocadm/lk_otsfera/pull/511) (прогон №4; `ORG_CARD_TAB_CAP`, `count` по тем же `where` → `tabTotals`, `ListCapNotice` под вкладками, задолженность — `order.aggregate`; страж `services.organizationCard.tab-caps.guardrail`, 7 мутаций пойманы) |

## Стражи, проверенные мутацией (для С-5)

Полный проход 19 стражей — 15.08.2026 (журнал в [AUDIT.md](AUDIT.md)). Круг
С-5 идёт по алфавиту именем файла `src/__tests__/*.guardrail.test.ts`;
следующий прогон начинает со стража после `navigation.org-card-tiles`.
Новые стражи и дата их мутационной проверки:

| Страж | Проверен мутацией |
|---|---|
| `docs.tz-program` (якоря реестра, сводка) | 19.08.2026 |
| правило ширины экранов / §0 живой обход | 20–21.08.2026 |
| `docs.tz-program` → `режим сопровождения` (колонка «Последний прогон», строки `С-N`, ссылки) | 21.08.2026 (три поломки, все пойманы) |
| `acceptance.audit-registry` (разбор строк AUDIT.md, отметка даты) | 05.09.2026 (этап 9, PR-3) |
| `auth.teamMode-required` | 05.09.2026 ✓ поймана |
| `components.no-db-import` | 05.09.2026 ✓ поймана |
| `components.upload-size-hint` | 05.09.2026 ✓ однострочная поймана · ✗ перенос prettier не пойман → хотфикс №2 #499: ✓ пойманы 4 (перенос prettier с цифрой, однострочная, перенос перед цифрой, голый перенос JSX-текста) |
| `config.alerts` | 05.09.2026 ✓ поймана |
| `config.env-example` | 05.09.2026 ✓ поймана |
| `config.env-registry` | 05.09.2026 ✓ поймана |
| `config.login-sla` | 05.09.2026 ✓ поймана |
| `config.onec-params` | 05.09.2026 ✓ поймана |
| `config.settings-from-ui` | 05.09.2026 ✓ поймана |
| `config.telephony-webhooks` | 05.09.2026 ✓ поймана |
| `config.upload-formats` | 05.09.2026 ✓ поймана (прогон №2) |
| `documents.document-template` | 05.09.2026 ✓ поймана (прогон №2) |
| `documents.generate-panel-mirror` | 05.09.2026 ✓ поймана (прогон №2) |
| `documents.send-button-mirror` | 05.09.2026 ✓ поймана (прогон №2) |
| `documents.superseded-versions` | 05.09.2026 ✓ поймана (прогон №2) |
| `e4.no-network` | 05.09.2026 ✓ поймана (прогон №2) |
| `email.templates` | 05.09.2026 ✓ поймана (прогон №2) |
| `errors.codes-covered` | 05.09.2026 ✓ поймана (прогон №2) |
| `featureFlags.route-gated` | 05.09.2026 ✓ поймана (прогон №2) |
| `featureFlags.third-gate` | 05.09.2026 ✓ поймана (прогон №2) |
| `help.glossary` | 05.09.2026 ✓ поймана (прогон №3) |
| `import.no-second-writer` | 05.09.2026 ✓ поймана (прогон №3): второй писатель в `matcher.ts` |
| `import.org-name-key` | 05.09.2026 ✓ поймана (прогон №3) |
| `navigation.breadcrumbs-coverage` | 05.09.2026 ✓ поймана (прогон №3): крошки убраны из вьюхи `manager-order-detail-view`; переименование пропа на странице — вне инварианта, ловит `tsc` (ℹ) |
| `navigation.icons` | 05.09.2026 ✓ поймана (прогон №3) |
| `navigation.menu-groups` | 05.09.2026 ✓ поймана (прогон №3): чужая группа `'Сбыт'` в `cabinet.ts`; фолбэк `menuGroupRank → 0` недостижим (ℹ) |
| `navigation.mirror` | 05.09.2026 ✓ поймана (прогон №3) |
| `navigation.org-card-registry-usage` | 05.09.2026 ✓ поймана (прогон №3) |
| `navigation.org-card-tabs` | 05.09.2026 ✓ поймана (прогон №3) |
| `navigation.org-card-tiles` | 05.09.2026 ✓ пойманы 2 (прогон №3) |
| `docs.feature-flags-matrix` (хотфикс №1) | 05.09.2026 ✓ пойманы 5: строка флага убрана; opt-out в таблице opt-in; счётчик шапки; призрак `partner_leads`; чужой класс в runbook |
| `services.documents.generalList` · `services.commission.corrections.unit` · `services.admin.pendingRecords.unit` · `components.ui-list-cap-notice` · `components.admin-pending-records-section` · страницы documents/corrections/1c-auto (хотфикс №4) | 05.09.2026 ✓ пойманы 8: `count` не зовётся (×2), `count` по другому `where`, условие `<` вместо `<=`, подпись не рисуется на странице, секция подставляет `records.length`, страница 1С теряет `total`, очереди корректировок передают 0 |
| `services.partner.finance` · `pages.partner-finance` (хотфикс №5) | 05.09.2026 ✓ пойманы 5: `count` не зовётся (total = 0), `skip` из адреса не уходит в сервис, `MAX_TAKE` не режет, `Paginator` убран со страницы, счётчик без `status`/`from`/`to` |
| `docs.commands-exist.guardrail` (хотфикс №6) | 05.09.2026 ✓ пойманы 3: в README появилась `npm run` несуществующего скрипта, в runbook — ссылка на несуществующий `scripts/*.ts`, из `package.json` пропал `worker` |
| `errors.no-silent-catch.guardrail` · `logging.bestEffort` (решение `Р-25`, `В-1`) | 05.09.2026 ✓ пойманы 6: тихий `.catch(() => {})` вернулся в `sessions.ts`; пустой `catch {}` без комментария в `admin/dashboard.ts`; исключение убрано из allow-list (стало «лишнее вхождение»); allow-list просит 3 вместо 2 в `worker/index.ts`; `bestEffort` перестал писать `warn` (упали 6 тестов — хелпер и четыре расширенных); `.catch(() => undefined)` вернулся в `attachments.ts` |
| `services.organizationCard.tab-caps.guardrail` · `services.organizationCard.integration` · `components.org-card-tabs` (хотфикс №10) | 06.09.2026 ✓ пойманы 7: голое `take: 20` у лидов; `count` лидов по `where` сделок; `tabTotals.deals` = 0 (страж + integration); задолженность снова `reduce` по показанным; подпись не рисуется; подпись берёт `shown` соседней вкладки; `count` комментариев не зовётся (страж + integration) |
| `navigation.page-title-matches-menu` (хотфикс №9) | 06.09.2026 ✓ пойманы 3: «Заказы» → «Заявки» в `manager/orders/page.tsx`; `sectionLabel('documents')` → `sectionLabel('orders')` в общем компоненте `staff-documents` (упали оба кабинета); страж перестал читать `PageHeader` — счётчик «прочитано > 50» падает |
| `deps.overrides.guardrail` (хотфикс №7, решение `Р-26`, `В-2`) | 05.09.2026 ✓ пойманы 3: в lock вернулась вложенная `next/node_modules/postcss@8.4.31`; из `package.json` убран override `uuid`; корневой `deepmerge-ts` откатился на 7.1.5 |
| `prisma.enum-terminal-last.guardrail` · `boards.status-order.integration` · `boards.cap-and-order.unit` · `services.deals.board` · `components.task-dialog` · страницы deals/funnel/tasks (решение `Р-27`, `В-3`) | 05.09.2026 ✓ пойманы 9: в `deals/board.ts` вернулся `orderBy createdAt`; из `tasks/board.ts` убран `count`; в `funnel/board.ts` `take` без `BOARD_CAP`; в `schema.prisma` `lost` переставлен перед `open`; в диалоге убран `withCurrent` (привязка терялась); `capHint` всегда `null`; `ListCapNotice` снят со страницы сделок руководителя и задач менеджера; организации формы снова по `name` |
| `services.deals.board` + `knip` (хотфикс №8, `С-1`) | 05.09.2026 ✓ пойманы 3: в сервисе `take: 501` вместо константы (тест + страж enum); `BOARD_CAP = 400`; из теста убран импорт константы — `knip` снова показывает 6 экспортов |

## Журнал прогонов

| Дата | Коммит | Проверка | Итог | PR |
|---|---|---|---|---|
| 05.09.2026 | `594cf347` | С-1…С-10 (первый полный прогон, этап 9 PR-3) | ❌ 5 · ⚠ 1 · ℹ 5; три хотфикса в очереди (№1 матрица флагов, №2 страж подсказки 200 МБ, №3 `npm audit fix`), два вопроса заказчику | #497 (прогон) · хотфиксы №1 #498 · №2 #499 · №3 #500 — все три влиты |
| 05.09.2026 | `f567f19f` → `c9e25e31` | прогон №2: очередь журнала (усечение списков, `С-6`), затем `С-1`…`С-10` | ❌ 2 · ⚠ 1 · ℹ 2 (плюс очередь); три хотфикса влиты — №4 подписи под усечёнными списками, №5 пагинация `/partner/finance`, №6 команды в чеклистах; новый вопрос заказчику `В-3`; unit 1093 / 11 849 · integration 181 / 1378 · Playwright 480 (275 выполнены, 0 падений) | [#501](https://github.com/aiprocadm/lk_otsfera/pull/501) · [#502](https://github.com/aiprocadm/lk_otsfera/pull/502) · [#503](https://github.com/aiprocadm/lk_otsfera/pull/503) · итог [#504](https://github.com/aiprocadm/lk_otsfera/pull/504) |
| 05.09.2026 | `12c3078a` → `b9d94408` | прогон №3: `С-1`…`С-10` после решений `Р-25`…`Р-27` | ❌ 1 · ⚠ 0 · ℹ 4; один хотфикс влит — №8 `BOARD_CAP` в тесте доски сделок (knip); unit 1099 / 11 892 · integration 182 / 1382 · Playwright 480 (275 выполнены, 0 падений, 30 мин); очередь журнала пуста | [#508](https://github.com/aiprocadm/lk_otsfera/pull/508) · итог [#509](https://github.com/aiprocadm/lk_otsfera/pull/509) |
