# Московское время в серверном коде — дизайн

**Дата:** 23.09.2026 · **Источник:** прогон сопровождения №36, проверка `С-10`
· **Режим:** сопровождение (CLAUDE.md §14), дефекты `❌` отгруженного кода.

> **Подтверждение.** По правилу §14 спека предъявляется заказчику до кода. Заказчик
> поручил исполнителю принимать решения самостоятельно («на все вопросы, которые
> возникают, принимай решение самостоятельно наиболее эффективное»), поэтому
> решения ниже (`Р-М-1`…`Р-М-5`) приняты исполнителем по этому поручению и
> записаны явно — заказчик может отменить любое.

## 1. Что сломано — простыми словами

Сервер и фоновый обработчик работают по времени **UTC** (Гринвич). Люди работают
по **Москве** (на 3 часа больше). Во многих местах код брал дату «по часам
сервера», а не по Москве. Итог:

- **Денежный документ врёт.** PDF ведомости комиссии за август пишет период
  «31.07.2026 — 31.08.2026» вместо «август 2026»; за январь — даже прошлый год
  («31.12.2025 — 31.01.2026»). Так с тех пор, как расчёт перевели на московские
  границы месяца (`Д-22`, прогон №28), а подписи — нет.
- **Фильтр «по 31.08» теряет почти весь день 31.08.** Поле даты отдаёт
  «2026-08-31», код читает это как 00:00 по Гринвичу = 03:00 по Москве и ставит
  «не позже». Журнал аудита, журнал доступа к ПДн, выгрузка документов в 1С,
  счета заказчика — и **перенос из Битрикс24**: лиды последнего дня периода
  не переносятся.
- **Задача «просрочена» в сам день срока** — с 03:00 по Москве.
- **Событие календаря «10:00» сохраняется как 13:00** по Москве.
- **Дата на экране «съезжает» на вчера** для всего, что случилось с 00:00 до
  03:00 по Москве (заказы, комментарии, оплаты, документы, журнал).
- **Экран ругается ошибкой гидратации**: сервер нарисовал текст по Гринвичу,
  браузер — по Москве, React перерисовывает страницу целиком (так и нашлось:
  «Финансы» партнёра в прогоне №36).

## 2. Доказательная база

Сверка классом (workflow `tz-date-class-sweep`, 91 агент): пять искателей по
темам + шестой, искавший **другими** способами (конструкторы дат,
`toISOString().slice(0, 10)`, `Intl.DateTimeFormat`, диапазоны от местной
полуночи). Каждая заявка перепроверена отдельным агентом **запуском** кода с
реалистичным значением от настоящего писателя в `TZ=UTC` и `TZ=Europe/Moscow`.

**Заявлено 85, подтверждено 81, отклонено 4.** Реестр мест — приложение А.

Группы:

| Группа | Суть | Мест |
|---|---|---|
| **А** | Показ даты без пояса (`toLocale*String`, `Intl.DateTimeFormat` без `timeZone`) | 47 |
| **Б** | Подпись периода ведомости (месяц по часам процесса) | 6 |
| **В** | Границы фильтров «с … по …» и года | 9 |
| **Г** | Сроки-даты: «просрочено», «скоро», «истекает» | 10 |
| **Д** | Время из формы (`datetime-local`) и «настенное» время | 6 |
| **Е** | Дата документа и дата в имени файла | 3 |

## 3. Правило (инвариант)

1. **Процесс остаётся в UTC** (`Р-М-1`). Переключить `TZ` процесса на Москву
   одной строкой соблазнительно, но это переворачивает правильность другого
   множества мест: даты-без-времени, собранные местным конструктором
   (`new Date(y, m, d)`), при `TZ=Europe/Moscow` уедут на день назад при записи
   в колонку `@db.Date`; тесты идут в UTC и перестанут отражать бой. Проект уже
   выбрал явный пояс (`lib/format.ts`, `lib/dates/calendar.ts`, `Д-22`) — его и
   держим.
2. **Всё, что видит человек, и всё, чем режется выборка, считается по Москве
   явно.** Показ — `fmtDate`/`fmtDateTime`/новый `fmtMonthPeriod` из
   `lib/format.ts`; любой другой формат — `Intl.DateTimeFormat` **с**
   `timeZone: 'Europe/Moscow'`. Границы — помощники `lib/dates/calendar.ts`.
3. **Календарный день — московский** (`Р-М-2`). Дата из поля `type="date"`
   («ГГГГ-ММ-ДД») как граница фильтра означает **московские сутки**:
   `[Д 00:00 МСК, Д+1 00:00 МСК)` — полуоткрыто, верхняя граница через `lt`.
4. **Срок-дата просрочен, когда закончился его московский день** (`Р-М-3`):
   `срок < начало сегодняшних суток по Москве`. Правило одно для обоих видов
   срока в базе — «только дата» (полночь UTC из формы) и «дата со временем»
   (Битрикс24): проверено на обоих, включая срок 22:30 UTC (01:30 МСК
   следующего дня).
5. **Время из `datetime-local` — московское «настенное» время** (`Р-М-4`):
   «2026-09-25T10:00» → `2026-09-25T10:00+03:00`. Строки портала Битрикс24 без
   пояса — тоже Москва (пояс портала заказчика).
6. **Клиентский компонент форматирует так же, как серверный** — иначе ошибка
   гидратации. Отсюда тот же `fmtDate`/`fmtDateTime` и в `'use client'`.

## 4. Помощники

В `src/lib/dates/calendar.ts` (рядом с `Д-22`):

- `moscowDayRange(ymd)` → `{ gte, lt } | null` — московские сутки по
  «ГГГГ-ММ-ДД» (с проверкой существования дня через `parseIsoCalendarDate`).
- `moscowRangeFilter(from?, to?)` → `{ gte?, lt? }` — готовый фильтр Prisma для
  пары полей «с/по».
- `moscowYearRange(year)` → `{ gte, lt }`.
- `moscowCalendarDay(now)` → «ГГГГ-ММ-ДД» по Москве (имена файлов, значение
  поля даты в форме).
- `parseMoscowWallClock(value)` → `Date | null` для `datetime-local`.
- экспорт `moscowYearMonth` (сейчас внутренний) — для сравнения месяцев.

В `src/lib/format.ts`:

- `fmtMonthPeriod(from, to, style)` — «август 2026» / «авг 2026», если начало и
  конец в одном московском месяце, иначе «дд.мм.гггг — дд.мм.гггг» по Москве.
  Одна функция вместо пяти копий (PDF, XLSX, экран партнёра, две страницы
  администратора).
- `fmtTime(value)` — «чч:мм» по Москве (календарь).

Две функции `startOfMoscowDay` с разным смыслом уже живут в проекте
(`lib/dates/calendar.ts` — момент 00:00 МСК; `lib/documents/proposalExpiry.ts` —
московский день в виде полуночи UTC). Не переименовываем (§9.4: без массовых
переименований), но правило 4 опирается только на первую, а у второй в
комментарии записано, чем она отличается.

## 5. Страж

`src/__tests__/dates.moscow-display.guardrail.test.ts` — по исходникам `src/**`
(без тестов, комментарии вырезаны помощником стражей):

1. `toLocaleDateString(` / `toLocaleTimeString(` / `new Intl.DateTimeFormat(` —
   только с `timeZone` в том же вызове.
2. `toLocaleString(` у даты — только с `timeZone` (у чисел пояс не нужен:
   различаем по получателю, список исключений с причинами).
3. Местные геттеры/сеттеры (`getMonth/getDate/getHours/getFullYear/getDay/
   setHours/setDate/setMonth`) — только в файлах из списка исключений с
   причиной (чисто клиентская навигация по сетке календаря и т.п.).
4. `new Date(<переменная>)` от значения поля `type="date"` в фильтре —
   ловится поведенческими тестами групп В, а не текстом.

Страж проверяется мутацией: вернуть `toLocaleDateString('ru-RU')` без пояса в
одном файле — красный; добавить местный геттер вне списка — красный.

## 6. Тесты

Для каждой группы — поведенческие тесты с **реалистичным значением от
настоящего писателя** и явным моментом «с 00:00 до 03:00 по Москве»:

- Б: `fmtMonthPeriod` для московских границ (`2026-07-31T21:00Z…
  2026-08-31T20:59:59.999Z`) → «август 2026»; январь → «январь 2026»; PDF/XLSX
  строят заголовок через неё.
- В: для каждого фильтра — запись в 23:30 МСК последнего дня попадает в
  «по Д», запись в 00:30 МСК дня `Д+1` — нет; «с Д» включает 00:30 МСК дня Д.
- Г: срок «только дата» Д не просрочен весь день Д по Москве и просрочен с
  00:00 МСК Д+1; срок из Битрикс24 22:30Z — по его московскому дню.
- Д: «10:00» из формы сохраняется как `07:00Z`; календарь показывает «10:00».
- Е: имя файла и дата документа в 01:30 МСК — сегодняшние по Москве.

Тесты, которые закрепляли старое (UTC) поведение, переписываются — это не
«подгонка под код», а приведение к требованию (§16): старое ожидание и было
дефектом.

## 7. План PR (каждый от `main`, без стеков)

1. **`fix(dates): подпись периода ведомости по Москве`** — группа Б +
   `fmtMonthPeriod` + денежные документы (PDF/XLSX «Сформировано»).
2. **`fix(dates): фильтры «с … по …» — московские сутки`** — группа В +
   `moscowDayRange`/`moscowRangeFilter`/`moscowYearRange`.
3. **`fix(dates): сроки-даты по московскому дню`** — группа Г.
4. **`fix(dates): время календаря и Битрикс24 — московское`** — группа Д + Е.
5. **`fix(dates): показ дат по Москве везде`** — группа А + страж §5 (страж
   последним: он краснеет, пока хоть одно место не починено).

## 8. Решения

| № | Решение | Почему |
|---|---|---|
| `Р-М-1` | Процесс остаётся в UTC, пояс задаётся явно | Смена `TZ` процесса ломает даты-без-времени и расходит тесты с боем |
| `Р-М-2` | Граница «с/по» — московские сутки, верх полуоткрыт | Человек выбирает день по своему календарю |
| `Р-М-3` | Срок просрочен, когда закончился его московский день | Одно правило для «только даты» и срока со временем из Битрикс24 |
| `Р-М-4` | `datetime-local` и строки портала без пояса — Москва | Все сотрудники и портал заказчика — в Москве |
| `Р-М-5` | Пять PR по группам, страж последним | Каждый PR проверяем отдельно; страж не краснеет посреди работы |
| `Р-М-6` | События календаря, созданные до починки, **не пересчитываются** | Календарь сотрудников в бою выключен (`staff_calendar` — opt-in, в боевом примере настроек не включён), единственный писатель — форма; сдвинутые на 3 часа записи есть только на стенде (демо). Миграция данных ради демо-записей — риск без пользы |

## 9. Вне объёма

- Сотрудник в **другом** поясе (Новосибирск) увидит московские даты — это
  правило продукта (все даты по Москве, `lib/format.ts`), а не дефект.
- Колонки `@db.Date` и их писатели не меняются: миграций нет.
- Хранимые значения не пересчитываются: неверным было чтение и показ, а не
  запись (кроме календаря — см. группу Д и решение `Р-М-6`).

## Приложение А. Реестр мест

| Группа | Место | Серьёзность | Вид | Фрагмент |
|---|---|---|---|---|
| А | `src/components/admin/managers-block.tsx:11` | средняя | дефект | `return new Intl.DateTimeFormat('ru-RU', {` |
| А | `src/components/admin/pending-records-section.tsx:13` | средняя | дефект | `const DATE_FMT = new Intl.DateTimeFormat('ru-RU', {` |
| А | `src/components/admin/pii-access-table.tsx:6` | средняя | дефект | `const dateFormatter = new Intl.DateTimeFormat('ru-RU', {` |
| А | `src/components/admin/users-table.tsx:64` | средняя | дефект | `{new Intl.DateTimeFormat('ru-RU').format(u.createdAt)}` |
| А | `src/components/automation/automation-screen.tsx:288` | низкая | гидратация | `return at ? new Date(at).toLocaleString('ru-RU') : '—';` |
| А | `src/components/client-requests/client-request-attachments-list.tsx:25` | низкая | гидратация | `return new Intl.DateTimeFormat('ru-RU', {` |
| А | `src/components/documents/document-detail-view.tsx:65` | низкая | гидратация | `return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric` |
| А | `src/components/documents/document-onec-push-block.tsx:55` | низкая | гидратация | `return new Intl.DateTimeFormat('ru-RU', {` |
| А | `src/components/import/import-history.tsx:73` | низкая | гидратация | `<CardRow label="Дата">{new Date(b.createdAt).toLocaleString('ru-RU')}</CardRow>` |
| А | `src/components/import/import-history.tsx:109` | низкая | гидратация | `{new Date(b.createdAt).toLocaleString('ru-RU')} // desktop table «Дата»` |
| А | `src/components/manager/manager-order-timeline.tsx:15` | средняя | дефект | `return new Intl.DateTimeFormat('ru-RU', {` |
| А | `src/components/manager/org-card-tabs.tsx:39` | средняя | дефект | `const dateRu = (d: Date) => new Date(d).toLocaleDateString('ru-RU');` |
| А | `src/components/manager/org-card-tabs.tsx:429` | средняя | дефект | `<Td>{dateRu(e.createdAt)}</Td> // EnrollmentsSection «Подана»` |
| А | `src/components/manager/org-card-tabs.tsx:489` | средняя | дефект | `<Td>{dateRu(d.createdAt)}</Td> // DocumentsSection «Дата»` |
| А | `src/components/manager/org-card-tabs.tsx:528` | средняя | дефект | `<Td>{dateRu(p.paidAt)}</Td> // PaymentsSection «Дата»` |
| А | `src/components/manager/org-card-tabs.tsx:611` | средняя | дефект | `<span>{dateRu(c.createdAt)}</span> // CommentsSection` |
| А | `src/components/manager/org-card-tabs.tsx:680` | средняя | дефект | `<Td className="whitespace-nowrap text-gray-500">{dateRu(m.createdAt)}</Td> // InboundMessa` |
| А | `src/components/manager/org-card-tabs.tsx:702` | средняя | дефект | `<MiniRow key={o.id} left={o.title} right={dateRu(o.createdAt)} /> // Overview «Последние з` |
| А | `src/components/manager/org-card-tabs.tsx:710` | средняя | дефект | `right={dateRu(p.paidAt)} // Overview «Последние оплаты»` |
| А | `src/components/manager/org-card-tabs.tsx:716` | средняя | дефект | `<MiniRow key={c.id} left={c.body.slice(0, 40)} right={dateRu(c.createdAt)} /> // Overview ` |
| А | `src/components/manager/org-card-tabs.tsx:769` | средняя | дефект | `<Td>{dateRu(r.createdAt)}</Td> // ClientRequestsSection «Подана»` |
| А | `src/components/manager/org-card-tabs.tsx:801` | средняя | дефект | `<Td>{dateRu(l.createdAt)}</Td> // LeadsSection «Создан»` |
| А | `src/components/manager/org-card-tabs.tsx:840` | средняя | дефект | `<Td>{dateRu(d.createdAt)}</Td> // DealsSection «Создана»` |
| А | `src/components/orders/order-status-panel.tsx:54` | низкая | гидратация | `return new Intl.DateTimeFormat('ru-RU', {` |
| А | `src/components/organization/org-employees-section.tsx:39` | средняя | дефект | `const dateRu = (d: Date) => new Date(d).toLocaleDateString('ru-RU');` |
| А | `src/components/organization/org-order-timeline.tsx:55` | средняя | дефект | `{new Intl.DateTimeFormat('ru-RU', {` |
| А | `src/components/partner/customer-access-section.tsx:19` | низкая | дефект | `return new Intl.DateTimeFormat('ru-RU', {` |
| А | `src/components/partner/documents-list.tsx:49` | низкая | гидратация | `return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric` |
| А | `src/components/partner/order-comments.tsx:6` | средняя | дефект | `return new Intl.DateTimeFormat('ru-RU', {` |
| А | `src/components/partner/order-timeline.tsx:55` | средняя | дефект | `{new Intl.DateTimeFormat('ru-RU', {` |
| А | `src/components/settings/one-c-auto-exchange.tsx:86` | средняя | дефект | `return new Intl.DateTimeFormat('ru-RU', {` |
| А | `src/components/tasks/linked-tasks-panel.tsx:87` | низкая | гидратация | `до {new Date(t.dueDate).toLocaleDateString('ru-RU')}` |
| А | `src/components/tasks/task-board.tsx:31` | низкая | гидратация | `return new Date(d).toLocaleDateString('ru-RU');` |
| А | `src/components/tasks/task-comments.tsx:62` | низкая | гидратация | `{new Date(c.createdAt).toLocaleString('ru-RU')}` |
| А | `src/components/tasks/task-list.tsx:119` | низкая | гидратация | `{row.dueDate ? new Date(row.dueDate).toLocaleDateString('ru-RU') : '—'}` |
| А | `src/components/tasks/task-list.tsx:183` | низкая | гидратация | `{row.dueDate ? new Date(row.dueDate).toLocaleDateString('ru-RU') : '—'}` |
| А | `src/components/tasks/task-page-screen.tsx:47` | средняя | дефект | `const due = task.dueDate ? new Date(task.dueDate).toLocaleDateString('ru-RU') : null;` |
| А | `src/components/tasks/task-page-screen.tsx:151` | средняя | дефект | `{new Date(h.at).toLocaleString('ru-RU')}` |
| А | `src/lib/audit/labels.ts:437` | средняя | дефект | `const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('ru-RU', {` |
| А | `src/lib/services/admin/piiAccess.ts:118` | средняя | дефект | `put(b.id, `Пакет миграции от ${b.createdAt.toLocaleDateString('ru-RU')}`);` |
| А | `src/lib/services/commission/pdf.ts:117` | средняя | дефект | `const calculatedAtStr = new Date(statement.calculatedAt).toLocaleDateString('ru-RU');` |
| А | `src/lib/services/commission/xlsx.ts:101` | высокая | дефект | `['Сформировано', new Date(statement.calculatedAt).toLocaleDateString('ru-RU')],` |
| А | `src/lib/services/documents/contractDocumentPdf.ts:155` | высокая | дефект | `...дополнительное соглашение к договору № ${data.baseContract?.number ?? '—'} от ${data.ba` |
| А | `src/lib/services/export/xlsx.ts:26` | высокая | дефект | `return d ? new Date(d).toLocaleDateString('ru-RU') : '—';` |
| А | `src/worker/processors/sla-escalation.ts:369` | средняя | дефект | `const due = task.dueDate ? new Date(task.dueDate).toLocaleDateString('ru-RU') : '—';` |
| А | `src/worker/processors/sla-escalation.ts:408` | средняя | дефект | `const due = task.dueDate ? new Date(task.dueDate).toLocaleDateString('ru-RU') : '—';` |
| А | `src/worker/processors/task-due-soon.ts:57` | средняя | дефект | `const dueLabel = task.dueDate ? new Date(task.dueDate).toLocaleDateString('ru-RU') : '';` |
| Б | `src/app/admin/commission-statements/[id]/page.tsx:50` | низкая | дефект | `if (f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear()) { return `${mont` |
| Б | `src/app/admin/commission-statements/page.tsx:50` | низкая | дефект | `if (f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear()) { return `${mont` |
| Б | `src/components/partner/commission-statements-list.tsx:43` | средняя | дефект | `if (f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear()) { return `${mont` |
| Б | `src/lib/services/commission/pdf.ts:107` | высокая | дефект | `if (f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear()) { return `${mont` |
| Б | `src/lib/services/commission/pdf.ts:110` | высокая | дефект | `return `${f.toLocaleDateString('ru-RU')} — ${t.toLocaleDateString('ru-RU')}`;` |
| Б | `src/lib/services/commission/xlsx.ts:27` | высокая | дефект | `return `${f.toLocaleDateString('ru-RU')} — ${t.toLocaleDateString('ru-RU')}`;` |
| В | `src/app/admin/commission-statements/page.tsx:63` | высокая | дефект | `const d = new Date(raw);` |
| В | `src/app/admin/settings/security/audit/page.tsx:28` | высокая | дефект | `const d = new Date(v);` |
| В | `src/app/admin/settings/security/personal-data/page.tsx:34` | высокая | дефект | `const d = new Date(v);` |
| В | `src/lib/documents/listFilters.ts:46` | низкая | дефект | `const current = now.getFullYear();` |
| В | `src/lib/services/admin/piiAccess.ts:138` | высокая | дефект | `if (filters.from \|\| filters.to) { where.createdAt = {}; if (filters.from) (where.createdAt` |
| В | `src/lib/services/bitrix/preview.ts:101` | высокая | дефект | `const from = settings.from ? new Date(settings.from) : null;` |
| В | `src/lib/services/manager/documents.ts:112` | средняя | дефект | `gte: new Date(Date.UTC(opts.year, 0, 1)),` |
| В | `src/lib/services/oneCSync/exportPackage.ts:60` | высокая | дефект | `const d = new Date(`${value}T00:00:00Z`);` |
| В | `src/lib/services/organization/invoices.ts:86` | средняя | дефект | `const d = new Date(edge === 'from' ? `${raw}T00:00:00.000Z` : `${raw}T23:59:59.999Z`);` |
| Г | `src/components/certificates/certificate-status-badge.tsx:28` | средняя | дефект | `const startOfToday = new Date(today); startOfToday.setHours(0, 0, 0, 0);` |
| Г | `src/components/tasks/task-dialog.tsx:34` | средняя | дефект | `return new Date(d).toISOString().slice(0, 10);` |
| Г | `src/components/training/certificate-badge.tsx:8` | низкая | дефект | `const days = Math.ceil((validUntil.getTime() - today.getTime()) / MS_PER_DAY);` |
| Г | `src/lib/services/certificates/xlsx.ts:75` | высокая | дефект | `status: STATUS_RU[certificateStatus(c.validUntil, now)],` |
| Г | `src/lib/services/manager/myDay.ts:194` | средняя | дефект | `validUntil: { gte: now, lt: soon },` |
| Г | `src/lib/services/tasks/board.ts:198` | средняя | дефект | `and.push({ dueDate: { lt: now }, status: { not: 'done' } });` |
| Г | `src/lib/services/tasks/overdue.ts:39` | средняя | дефект | `{ status: { not: 'done' as const }, dueDate: { lt: now } },` |
| Г | `src/lib/services/training/certificates.ts:90` | средняя | дефект | `const startOfToday = startOfMoscowDay(today); const days = Math.ceil((validUntil.getTime()` |
| Г | `src/worker/processors/sla-escalation.ts:342` | средняя | дефект | `dueDate: { lt: now },` |
| Г | `src/worker/processors/task-due-soon.ts:18` | средняя | дефект | `d.setDate(d.getDate() + 1); d.setHours(23, 59, 59, 999);` |
| Д | `src/components/calendar/calendar-month-view.tsx:31` | средняя | дефект | `return `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;` |
| Д | `src/components/calendar/calendar-month-view.tsx:36` | низкая | гидратация | `return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '` |
| Д | `src/components/calendar/calendar-month-view.tsx:140` | низкая | гидратация | `{day.getDate()}` |
| Д | `src/components/custom-fields/entity-custom-fields.tsx:33` | низкая | гидратация | `return `${fmtDate(value)}, ${String(d.getHours()).padStart(2, '0')}:${String( d.getMinutes` |
| Д | `src/lib/services/bitrix/cells.ts:58` | средняя | дефект | `const d = new Date(Date.UTC(year, month, day, Number(hh), Number(mi), Number(ss)));` |
| Д | `src/server-actions/calendar/index.ts:42` | высокая | дефект | `startsAt: new Date(startsAt), endsAt: endsAt ? new Date(endsAt) : null,` |
| Е | `src/lib/documents/fileName.ts:65` | средняя | дефект | `const date = new Date(doc.createdAt).toLocaleDateString('ru-RU');` |
| Е | `src/lib/services/documents/generate.ts:729` | высокая | дефект | `const documentDate = args.extras?.documentDate ?? args.now ?? new Date();` |
| Е | `src/lib/services/oneCSync/exportPackage.ts:434` | низкая | дефект | `const stamp = now.toISOString().slice(0, 10);` |

**Отклонены перепроверкой (4):**

- `src/lib/services/tasks/notify.ts:24` — Не подтвердилось. Код в notify.ts:24 и правда зависит от пояса процесса: `toLocaleDateString('ru-RU')` без timeZone. Но ни один путь, по которому человек реально попадает сюда из интерфейса, не передаёт в него срок со временем суток. Кто вызывает notifyTaskAss…
- `src/lib/services/contacts/get.ts:421` — The formatting part of the claim is true. src/lib/services/contacts/get.ts:421 calls `r.dueDate.toLocaleDateString('ru-RU')` with no timeZone, on the server. Task.dueDate is a full `DateTime?` (prisma/schema.prisma:1195), not @db.Date. The counterexample fails…
- `src/lib/services/leader/managerLoad.ts:53` — Это не ошибка часового пояса. Сам пример воспроизводится, но от пояса процесса он не зависит. 1) Кто записывает срок. Форма задачи (task-dialog.tsx:184, quick-task-dialog.tsx:63, linked-tasks-panel.tsx:109) использует <input type="date">. Серверное действие sr…
- `src/lib/services/documents/zip.ts:68` — The mechanism is right, but a Moscow user never sees the result through the product. (1) src/lib/services/documents/zip.ts:67-70: archiveFileName(now) = `Документы ${now.toISOString().slice(0,10)}.zip`. This is always the UTC day, even in a Moscow process, bec…

## Итог (23.09.2026)

Отгружено пятью PR: [#674](https://github.com/aiprocadm/lk_otsfera/pull/674), [#675](https://github.com/aiprocadm/lk_otsfera/pull/675), [#676](https://github.com/aiprocadm/lk_otsfera/pull/676), [#678](https://github.com/aiprocadm/lk_otsfera/pull/678), [#677](https://github.com/aiprocadm/lk_otsfera/pull/677). Сверх реестра страж и агенты нашли ещё около
двадцати мест того же класса (заказы и оплаты в кабинетах, письма об оплате,
PDF заказа и КП, форма сделки, API финансов партнёра, напоминания об
удостоверениях, срок КП, показатель «Просроченные задачи») — все починены.
Попутно печать дат ускорена в ~70 раз (общий форматтер на модуль).
