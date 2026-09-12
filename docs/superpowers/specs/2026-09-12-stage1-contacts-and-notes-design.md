# Этап 1 — контакты и внутренние заметки

**ТЗ:** [CRM для отдела продаж — замена Битрикс24](../../tz/2026-09-12-tz-crm-bitrix-replacement.md) (индекс, 12.09.2026), требования `У-178`…`У-187`; текст требований — пакет [04_crm_core.md](../../specs/04_crm_core.md), порядок задач — [15 Task 1…4](../../specs/15_claude_code_tasks.md). Решения программы: `Р-Б-4` (контакты раньше миграции), `Р-Б-8` (заметки — `OrganizationNote`, `Comment` не трогаем), `Р-Б-9` (новых ролей нет). Наследуются: `Р-23` (общий презентационный компонент для зеркальных экранов), `Р-М-3` (скоуп как у входящих), `Р-М-5` (переписку ведёт менеджер), `Р-М-8` (написать первым — только тому, чей адрес известен).
**Дата:** 12.09.2026. **База:** `main` = `3b86dcf7` (после PR ввода программы #584). **Статус:** ждёт подтверждения заказчика.

## 0. Коротко

В Битрикс24 у отдела продаж есть две вещи, которых в ЛК нет: **справочник людей** (контактов) с карточкой и **внутренние заметки по клиенту**, которых клиент не видит. Без них переносить данные из Битрикса некуда (`Р-Б-4`), поэтому этап идёт первым.

Что уже есть в коде: таблицы `Contact` и `ContactChannel` с уникальностью канала в компании, автосоздание контактов из входящих и звонков, привязка контакта к диалогам мессенджеров, звонкам, входящим письмам и заказу (`primaryContactId`). **Чего нет:** экрана и карточки (флаг `contacts` выключен и закрывает только триаж-действия), объединения дублей, заметок по организации, права на контакты в профиле доступа, контакта в глобальном поиске, записи в журнал ПДн при просмотре.

Этап делает контакты **видимыми и управляемыми**: три зеркальных раздела «Контакты» (менеджер, руководитель, администратор), карточка контакта со всем, что с человеком связано, объединение дублей одной кнопкой, вкладки «Контакты» и «Заметки» в карточке организации, единая лента «История». Всё — под флагом `contacts`, который включается из «Функций платформы», а не с сервера.

## 1. Что показала сверка кода (§16)

Сверено на `3b86dcf7`. «Есть» — найдено с якорем, «нет» — искали и не нашли.

| Требование | Что в коде сейчас |
|---|---|
| `У-178` экран «Контакты» | Страниц `/{manager,leader,admin}/contacts` нет; `SectionKey` `contacts` нет в [sectionLabels.ts](../../../src/lib/navigation/sectionLabels.ts); флаг `contacts` в [featureFlags.ts](../../../src/lib/featureFlags.ts) — opt-in, **не** в `FEATURE_PREFIXES` (то есть уже поведенческий и переключаемый из UI), закрывает только `bindCallAction` и два `createContactFrom*Action` в [server-actions/contacts.ts](../../../src/server-actions/contacts.ts) |
| `У-179` карточка контакта | Нет. Данные для вкладок есть: `MessengerDialog.contactId`, `Call.contactId`, `InboundMessage.contactId`, `Order.primaryContactId`, `Deal.contactId` (поле **без relation** и без единой записи в код — мёртвое: `grep contactId src/lib/services/deals` пусто). `Task.linkedContactId` нет — этап 4 (`У-220`) |
| `У-180` создание/правка/архив | Есть только `createContact` в [manager/contacts.ts](../../../src/lib/services/manager/contacts.ts) (проверка компании и скоупа организации, первый канал — основной, аудит `contact_created`) и `captureChannel` (learn-on-link, идемпотентен). Правки, архива, смены основного канала нет. Уникальность `@@unique([companyId, type, normalizedValue])` держит база; при нарушении `createContact` бросает `P2002` наружу — русской подсказки нет |
| `У-181` объединение | Нет ни сервиса, ни поля `mergedIntoId` |
| `У-182` вкладка «Контакты» | В [orgCardTabs.ts](../../../src/lib/navigation/orgCardTabs.ts) ключа `contacts` нет; порядок вкладок закреплён стражем `navigation.org-card-tabs.guardrail`. Исключения зеркала ([mirrorExceptions.ts](../../../src/lib/navigation/mirrorExceptions.ts)) устроены по `SectionKey` меню, вкладки карточки фильтруются полем `cabinets` реестра — отдельной записи для вкладок не требуется, причина пишется комментарием в реестре (так сделано для «Оплаты», «Лиды», «История») |
| `У-183` заметки | `OrganizationNote` нет. Образец рядом: `DealNote` ([dealNotes.ts](../../../src/lib/services/manager/dealNotes.ts)) — тело, автор, упоминания через `extractMentions`/`listColleagues` из [staffChat/mentions.ts](../../../src/lib/services/staffChat/mentions.ts), уведомление `deal_note_mention` (реестр [notifications/registry.ts](../../../src/lib/notifications/registry.ts), один `producer` на тип — страж `notifications.registry.guardrail` требует строку типа в файле-продьюсере). Автокомплит `@Имя` в UI есть **только** у чата команды ([staff-composer.tsx](../../../src/components/staff-chat/staff-composer.tsx)); форма заметки сделки — голая `Textarea` без подсказки имён |
| `У-184` «История» | Вкладка показывает `auditTrail` из [organizationCard.ts](../../../src/lib/services/manager/organizationCard.ts): 20 строк `AuditLog` + `count`, грузится на каждой вкладке карточки. Заметок, диалогов, звонков и писем в ленте нет; фильтра по типу и постраничности нет. Отдельной модели истории статусов заказа нет — смены статуса живут в том же `AuditLog` |
| `У-185` поиск | [globalSearch.ts](../../../src/lib/services/search/globalSearch.ts): восемь категорий, контактов нет; скоупы — [search/scopes.ts](../../../src/lib/services/search/scopes.ts). Палитра ([command-palette.tsx](../../../src/components/shell/command-palette.tsx)) берёт группы из того же сервиса — отдельной работы не потребует |
| `У-186` ПДн | Контекста `contact_card` в [pii/contexts.ts](../../../src/lib/pii/contexts.ts) нет; есть `messengers_candidates` (список кандидатов «Нового диалога» с контактами). Страж `pii.capture-coverage` требует вызов `recordPiiAccess` со строкой контекста в заявленном `callSite` |
| `У-187` стражи | Есть образцы: `security.role-access-matrix.guardrail` (ловит новый экспортируемый предикат доступа), `navigation.mirror.guardrail` (меню), `pages.subtitles.guardrail` (`PageHeader`), `featureFlags.third-gate.guardrail` (страница читает флаг сама), тест эквивалентности скоупа `messengers.scope.unit` (Prisma-форма = in-memory двойник) |

**Расхождения пакета с кодом (пути и имена).** Пакет писался по аудиту, но в четырёх местах называет то, чего в репозитории нет; спека следует коду, а не пакету (правило индекса: расхождение — дефект пакета, не повод менять код).

| Пакет пишет | На самом деле |
|---|---|
| `src/lib/server-actions/*` | server actions лежат в **`src/server-actions/`** ([contacts.ts](../../../src/server-actions/contacts.ts), [messengers.ts](../../../src/server-actions/messengers.ts)) |
| `components/org-card/*` | папки нет; вкладки карточки рисует **`src/components/manager/org-card-tabs.tsx`** (796 строк, `renderSectionBody` по ключу вкладки), секции ролей — в `src/components/organization/*` (образец `org-employees-section.tsx`) |
| `e2e/*` | эталоны Playwright — **`src/e2e/snapshots/*.spec.ts`**, viewport 1280×800 и 390×844 из [playwright.config.ts](../../../playwright.config.ts) |
| «`mention-input` извлечь из заметок сделки» | у заметок сделки нет подсказки имён; извлекать надо из **чата команды** (`staff-composer.tsx`) |
| «перенос задач при объединении» | `Task.linkedContactId` появится в этапе 4 — объединение переносит задачи **там**, здесь список переноса без задач |

**Попутные находки вне объёма (не чиним в этом этапе):** в редакторе ролей ([role-editor.tsx](../../../src/components/access/role-editor.tsx):38) охват `orders` подписан «Заявки» — дореформенное слово, глоссарий требует «Заказы» (`У-96`); кандидат в хотфикс §9.4, записан здесь, чтобы не потеряться.

## 2. Модели

Миграция `2026091xxxxxxx_stage1_contacts_notes` — аддитивная и обратимая (новая таблица, две новые nullable-колонки, один индекс, две правки данных с обратным SQL в комментарии).

```prisma
/// Внутренняя заметка по организации (`У-183`, `Р-Б-8`). Видна только
/// сотрудникам компании-продавца; клиент и партнёр — никогда.
model OrganizationNote {
  id             String       @id @default(cuid())
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  companyId      String
  company        Company      @relation("CompanyOrganizationNotes", fields: [companyId], references: [id], onDelete: Cascade)
  organizationId String
  organization   Organization @relation("OrganizationNotes", fields: [organizationId], references: [id], onDelete: Cascade)
  authorId       String?
  author         User?        @relation("OrganizationNoteAuthor", fields: [authorId], references: [id], onDelete: SetNull)
  body           String       // до 4 000 символов, plain text с @упоминаниями
  mentionUserIds String[]     // денормализация для уведомлений и подсветки
  pinnedAt       DateTime?    // не null — закреплена (до трёх на организацию)

  @@index([organizationId, createdAt])
  @@index([companyId])
}

model Contact {
  // …существующие поля без изменений…
  /// `У-181`: после объединения — ссылка на главный контакт; сам контакт в архиве.
  mergedIntoId String?
  mergedInto   Contact?  @relation("ContactMerged", fields: [mergedIntoId], references: [id], onDelete: SetNull)
  mergedFrom   Contact[] @relation("ContactMerged")
}
```

**Правки данных в той же миграции:**

1. `NotificationRule`: `eventType = 'deal_note_mention'` → `'note_mention'` (обобщение, §3.6); обратный SQL — `note_mention` → `deal_note_mention`.
2. `AccessProfile.capabilities`: ко всем существующим профилям добавляется `'crm.contacts'` (§3.2) — иначе включение флага молча отняло бы раздел у профилей, заведённых до этапа; обратный SQL — `array_remove`.

`Deal.contactId` остаётся строкой без relation (менять модель сделки — вне объёма); объединение обновляет его как поле. `bitrixId` — этап 2 (`Р-Б-11`), здесь не заводится.

## 3. Ключевые решения

### 3.1. Скоуп контактов — один файл, две формы (`У-187`)

`src/lib/services/contacts/scope.ts`: `contactScopeWhere(session, teamMode)` (Prisma) и `isContactInScope(session, teamMode, contact)` (in-memory), тест эквивалентности как у [messengers/scope.ts](../../../src/lib/services/messengers/scope.ts).

Правило: контакт принадлежит компании (`companyId` — пол, страховка `'__no_company__'`); **контакт с организацией виден тем, кому видна организация** (`managerOrgScope(session, teamMode)` — то есть командная видимость, закрепления и охват `organizations` профиля доступа работают автоматически); **контакт без организации** («с улицы») виден всем сотрудникам компании — иначе его не увидит никто, ведь закреплять его не за что. Администратор — пол компании (Model A). `teamMode` — обязательный параметр без значения по умолчанию; страж-мутация проверяет, что дефолт не вернулся (урок `teamMode: boolean = false` из CLAUDE.md §16). Чужая компания, партнёр, заказчик → `not_found` / 404 (страницы — `notFound()`, сервисы — код `not_found`; IDOR-тесты на каждую точку).

### 3.2. Право `crm.contacts` в профиле доступа

В `capabilitySchema` ([accessProfileSchema.ts](../../../src/lib/auth/accessProfileSchema.ts)) добавляется `'crm.contacts'` с подписью «Контакты (справочник)» в редакторе ролей. Смысл: **сессия без профиля** — доступ есть (тождество no-profile, как у остальных прав); **сессия с профилем** — только при наличии права. Объём данных при наличии права задаёт охват `organizations` того же профиля (§3.1) — отдельного охвата «контакты» не заводим: контакт следует за организацией, а третья шкала в редакторе ролей ничего не добавила бы, кроме путаницы. Существующие профили получают право миграцией (§2), новые — галочкой. Проверяется в трёх точках: пункт меню, страница (`notFound`), сервисы (`not_found`).

`settings.*` для новых разделов хаба (автоматизация, шаблоны, материалы, KPI), упомянутые в Task 1, в этапе 1 **не заводятся**: разделов ещё нет, а право без раздела — мёртвый код (`knip`) и ложная галочка в редакторе. Каждое появится со своим этапом.

### 3.3. Список и карточка — один компонент, три кабинета (`У-178`, `У-179`, `Р-23`)

Страницы `/manager/contacts`, `/leader/contacts`, `/admin/contacts` и `/…/contacts/[id]` — тонкие: гард роли (`requireManager` / `requireManagerLeader` / `requireAdmin`), флаг, сервис, презентационный компонент `ContactList` / `ContactCard` из `src/components/contacts/` с `hrefFor(cabinet)` для ссылок на карточки организаций и заказов **своего** кабинета (образец `OrgCardTabs`). Руководитель смотрит на всю компанию (`teamModeOverride`, как `/leader/organizations`), администратор — пол компании.

Раздел в меню: `SectionKey` `contacts` → «Контакты», значок `contacts` (новый ключ в `icons.ts`), группа «Клиенты» сразу после «Организации» — во всех трёх кабинетах ЦО одинаково, страж зеркала без исключений. Ключ раздела в CLAUDE.md §5 (`SectionKey`), подзаголовок через `PageHeader`: «Люди, с которыми вы общаетесь: телефоны, почта и мессенджеры в одном месте».

**Список:** колонки Имя · Должность · Организация (ссылка или «Без организации») · Каналы (значки типов) · Обновлён; поиск одной строкой по имени, организации, e-mail и телефону (строка из ≥ 5 цифр нормализуется `normalizePhoneCanonical` и ищется по `ContactChannel.normalizedValue`); фильтры «Все / С организацией / Без организации / Архив»; сортировка по имени и по дате; постраничность 50 с `total` и «Показаны N из M». Пустое состояние: «Контактов пока нет — добавьте первого» с кнопкой. Мобильный — карточки вместо таблицы (`grid-cols-1`, урок стража ширины).

**Карточка:** шапка (имя, должность, организация → карточка организации, значки каналов, кнопки «Написать» и «Создать лид» — §3.12, меню «Изменить · Объединить · В архив»), блок «Каналы» (список, признак основного, «Сделать основным», добавить/удалить), вкладки **Диалоги · Звонки · Входящие письма · Сделки · Заказы · История** (по `contactId` / `primaryContactId` / `Deal.contactId` / `AuditLog` по `entity='contact'`; вкладка «Задачи» — этап 4, до него в реестре вкладок её нет — пустая вкладка есть дефект `У-74`). Вкладки под флагами своих разделов (`inbound_messaging`, `telephony_mango`, `deals_pipeline`). Пустые состояния с действием: «Диалогов пока нет — напишите первым». Контакт с `userId` (пользователь кабинета): каналы e-mail/мессенджеров, совпадающие с полями `User`, помечены «из кабинета» и не редактируются (подсказка «Это данные пользователя кабинета — меняются в его профиле»).

### 3.4. Каналы: занятый канал — подсказка, а не ошибка базы (`У-180`)

`src/lib/services/contacts/mutate.ts`: `updateContact`, `archiveContact` (и `restoreContact`), `addChannel`, `removeChannel`, `setPrimaryChannel`. Перед записью канала — поиск `(companyId, type, normalizedValue)`; занят → Result `{ ok:false, error:'contact_channel_taken', conflict:{ contactId, name } }`, форма показывает «Этот телефон уже у контакта Петров П.П.» с кнопками «Открыть» и «Объединить» (§3.5). Гонка (два запроса разом) — `P2002` ловится и превращается в тот же код. Тексты кодов — в `errors/messages.ts`: `contact_channel_taken`, `contact_merge_self`, `contact_merge_two_users`, `contact_merge_target_merged`, `contact_channel_locked`, `note_too_long`, `note_pin_limit`, `note_edit_expired`.

Все мутации — server actions в `src/server-actions/contacts.ts` (существующий файл дополняется): флаг → `forbidden`, Zod только на форму, `revalidatePath` списка, карточки контакта и карточки его организации во всех трёх кабинетах (контакт виден в трёх местах). Аудит: `contact_updated`, `contact_archived`, `contact_restored`, `contact_channel_added`, `contact_channel_removed`, `contact_merged` — в `AUDIT_ACTIONS` и `labels.ts`.

### 3.5. Объединение дублей — одна транзакция, один главный (`У-181`)

`src/lib/services/contacts/merge.ts` `mergeContacts(prisma, session, teamMode, { primaryId, secondaryId })`. Оба контакта — в скоупе и одной компании; иначе `not_found`. Отказы: `primaryId === secondaryId` → `contact_merge_self`; у обоих есть `userId` → `contact_merge_two_users` (два пользователя кабинета — это два человека); главный сам уже объединён (`mergedIntoId != null`) → `contact_merge_target_merged`.

В транзакции: каналы второго → главному (тип+значение уникальны в компании, конфликтов быть не может; признак основного у перенесённых снимается); `InboundMessage.contactId`, `Call.contactId`, `MessengerDialog.contactId`, `Order.primaryContactId`, `Deal.contactId` — `updateMany`; `userId` второго переезжает, если у главного пустой; пустые `position` / `note` главного заполняются из второго (непустые не затираются); второй — `isArchived = true`, `mergedIntoId = primaryId`. Аудит `contact_merged` с `before` (снимок второго: имя, каналы, счётчики связей) — чтобы разбирать спорные объединения. Страница `/…/contacts/[id]` при `mergedIntoId` делает `redirect` на главного (цепочка длиной > 1 невозможна из-за отказа `contact_merge_target_merged`).

Точки входа: меню карточки «Объединить» (диалог выбора второго контакта — поиск по списку) и кнопка «Объединить» в подсказке занятого канала (§3.4). Список кандидатов — контакты скоупа, кроме архивных и самого себя.

### 3.6. Заметки организации и `note_mention` (`У-183`, `Р-Б-8`)

`src/lib/services/organizationNotes/{list,mutate}.ts`. **Кто видит:** сотрудники ЦО компании организации (`isStaffManagerSide` или admin, `companyId` совпадает) — партнёр и заказчик получают `not_found` на любой вызов, страж IDOR. **Кто пишет:** менеджер, руководитель, админ. **Правка:** автор — 24 часа с `createdAt` (`note_edit_expired` после), руководитель и администратор — всегда. **Удаление:** руководитель и администратор, аудит `organization_note_deleted` с телом в `before`. **Закрепление:** `pinnedAt`, не больше трёх (`note_pin_limit`); закреплённые — сверху вкладки и блоком «Важное» на «Обзоре». Длина — 4 000 символов (`note_too_long` до сохранения).

**Упоминания.** `extractMentions` + `listColleagues` из чата команды (реюз, не копия); найденные id пишутся в `mentionUserIds`. Уведомление — **новый общий тип `note_mention`** («Упоминание в заметке») вместо `deal_note_mention`: один тип, поле `meta.entity: 'deal' | 'organization'` и ссылка на объект. Отправка выносится в `src/lib/notifications/noteMention.ts` (`notifyNoteMention`) — это и есть `producer` реестра; `dealNotes.ts` и заметки организации зовут его. Fail-open (ошибка уведомления не роняет заметку — как сейчас). Правила `NotificationRule` переезжают миграцией (§2); ключ `deal_note_mention` из реестра удаляется, исторические строки `Notification.type` не трогаем — подпись для них берётся через `tzAlias`-подобную таблицу псевдонимов `LEGACY_TYPE_ALIASES` в реестре (прецедент `tzAlias`: не переименовывать историю ради косметики).

Композитор заметки с подсказкой имён — общий компонент `src/components/ui/mention-textarea.tsx`, **извлечённый** из `staff-composer.tsx` (чат команды переводится на него тем же PR — иначе `jscpd`); форма заметки сделки в этом этапе не трогается (вне объёма), но получит его бесплатно позже.

### 3.7. Вкладки «Контакты» и «Заметки» в карточке организации (`У-182`)

В `ORG_CARD_TABS` — `{ key:'contacts', label:'Контакты', iconKey:'contacts', cabinets: STAFF, flag:'contacts' }` после «Сотрудники» и `{ key:'notes', label:'Заметки', iconKey:'notes', cabinets: STAFF }` после «Комментарии» — порядок из пакета 04 §3; причина «только ЦО» — комментарием в реестре («внутренние данные продавца», как у «Оплаты»/«История»). Вкладка «Диалоги» — этап 3 (`У-210`), здесь не объявляется. Плитка-счётчик «Контакты» = не архивные контакты организации. Данные вкладок грузит страница роли **только когда вкладка активна** (как `employees`), компонент `OrgCardTabs` получает готовые секции `contacts` / `notes` (React-узлы), не ходит в базу. Секции — `src/components/organization/org-contacts-section.tsx` (список контактов организации, «Добавить контакт» с предзаполненной организацией, «Сделать основным для заказов» — выставляет `primaryContactId` заказам без контакта? **нет**: это молчаливая массовая правка; кнопка ведёт в заказ — §3.12) и `org-notes-section.tsx`.

### 3.8. «История» — единая лента с честной постраничностью (`У-184`)

`src/lib/services/organization/orgHistory.ts` `listOrgHistory(prisma, session, { orgId, type?, skip })`, грузится только при активной вкладке; поле `auditTrail` и его `count` из `getOrganizationCard` **убираются** (один запрос меньше на каждой вкладке карточки). Источники и типы фильтра: `audit` (журнал, включая смены статусов заказа — отдельной модели у них нет), `note` (заметка создана), `dialog` (диалог мессенджера — последнее сообщение), `call` (звонок), `inbound` (входящее письмо). Каждый элемент — время, автор или собеседник, тип, короткий текст, ссылка на объект.

Постраничность: **с выбранным типом** — точные `skip/take 20` и `total` по одному источнику; **«Все типы»** — из каждого источника берётся верх (50), лента сливается по времени, показывается первые 20 со сдвигом; `total` = сумма счётчиков, подпись «Показаны N из M — для просмотра глубже выберите тип». Это честнее «бесконечной» ленты, которая тихо теряет старые записи одного источника, и не требует объединяющей таблицы. Источники под выключенными флагами (`inbound_messaging`, `telephony_mango`) в ленту не попадают.

### 3.9. Поиск: контакт по имени, почте и телефону в любом написании (`У-185`)

Категория `contacts` («Контакты») в `globalSearch.ts` и `search/scopes.ts` (`contactScopeWhere`). Условие: `name contains` или `channels.some({ type:'email', normalizedValue contains lower(q) })`; если в запросе ≥ 5 цифр — дополнительно `channels.some({ type in [phone, whatsapp], normalizedValue contains digits(q) })` — так «+7 (921) 123-45-67», «8921…» и «921 123» находят один контакт. Ссылка результата — карточка в кабинете сессии. Участвует только при включённом `contacts` (поиск не раскрывает выключенный модуль). Палитра меняется сама. Журнал ПДн — контекст `contacts_search` (список).

### 3.10. ПДн: три контекста (`У-186`)

`PII_CONTEXTS`: `contact_card` (view, «Карточка контакта», `callSite: src/lib/services/contacts/get.ts`), `contacts_list` (list, «Список контактов», `list.ts`), `contacts_search` (list, `globalSearch.ts` — файл уже `callSite` других контекстов). `subjectType` — новый `'contact'`, подпись в фильтре `/admin/pii-access`. Вкладка «Контакты» карточки организации идёт через `list.ts` — пишется тем же контекстом.

### 3.11. Флаг `contacts` — уже поведенческий, добираем три точки

Флаг не в `FEATURE_PREFIXES`, поэтому переключатель в «Функциях платформы» для него **уже активен** (`editable: !isRouteGatedFlag`). Добираем точки чтения: пункт меню (`flag: 'contacts'`), страницы (`notFound()` при выключенном — страж `third-gate`), server actions (`forbidden`), вкладка карточки (`flag` в реестре), категория поиска. Флаг остаётся **opt-in** (выключен по умолчанию): раздел появляется, когда заказчик включит его из интерфейса — так на стенде можно посмотреть до, а не после. `docs/feature-flags-matrix.md` — строка переписывается.

### 3.12. «Написать», «Создать лид», контакт в заказе и сделке

- **«Написать»** (`Р-М-8`): ведёт на `/manager/messengers?new=<contactId>` — кнопка «Новый диалог» открывается с предвыбранным человеком (у `NewDialogButton` появляется проп `preselect`). Показывается, когда включён `inbound_messaging`, контакт не в архиве и у него есть канал мессенджера; иначе — неактивная кнопка с причиной («У контакта нет мессенджера»). Руководитель — та же ссылка в кабинет менеджера («играющий тренер», `Р-М-5`); у администратора кнопки нет (переписку не ведёт — та же причина, что у исключения `messengers`), причина — комментарием рядом с кнопкой. E-mail-канал — `У-205`, этап 3.
- **«Создать лид»**: сервис `createLeadFromContact` рядом с `createLeadFromInbound` / `createLeadFromCall` в [intake/convert.ts](../../../src/lib/services/intake/convert.ts) — источник `manual`, поля `clientContact*` из контакта и его основных каналов, организация — контакта; после создания — переход в карточку лида. Отдельной страницы создания лида в системе нет и не заводится.
- **Карточка лида**: блок «Контакт» — контакт, найденный по телефону/e-mail лида через `resolveContactByChannel`, со ссылкой; не найден — кнопка «Создать контакт из данных лида» (`createContact` с каналами лида). Обращения (`ClientRequest`) не трогаем — у них контакт задаёт пользователь кабинета.
- **Карточка заказа**: блок «Контакт заказа» — `Order.primaryContactId`, выбор из контактов организации заказа (`setOrderPrimaryContact` в `services/orders/`, аудит). **Карточка сделки**: «Контакт» по `Deal.contactId` со ссылкой и выбором из контактов организации сделки — поле перестаёт быть мёртвым.

### 3.13. Границы этапа

Не делаем здесь: вкладку «Задачи» и `linkedContactId` (этап 4), вкладку «Диалоги» в карточке организации (`У-210`, этап 3), e-mail как канал «Написать» (`У-205`), `bitrixId` (этап 2), статусы контакта (пакет: не заводим), третью модель заметок (заметка о контакте — это заметка его организации с префиксом «О контакте …»), права `settings.*` будущих разделов (§3.2), правку формы заметки сделки, удаление `SavedView` (этап 9).

## 4. Разбивка на PR

Четыре PR от `main`, каждый зелёный сам по себе, порядок нарушать нельзя (PR-2 читает сервисы PR-1, PR-3 — компонент `mention-textarea` и сервисы заметок PR-1, PR-4 закрывает флаг после появления всех точек).

| PR | Что | Требования | Файлы (главное) |
|---|---|---|---|
| **PR-1 «основа»** (Task 1) | миграция (`OrganizationNote`, `Contact.mergedIntoId`, правила `note_mention`, `crm.contacts` в профилях); `crm.contacts` в схеме профиля и редакторе ролей; `services/contacts/{scope,list,get,mutate,merge}.ts`; `services/organizationNotes/{list,mutate}.ts`; `notifications/noteMention.ts` + реестр (`note_mention`, псевдоним); `pii/contexts.ts` (три контекста, `subjectType: contact`); аудит-действия и подписи; коды ошибок; стражи IDOR / `teamMode`-мутация / эквивалентность скоупа | `У-180` (сервис), `У-181` (сервис), `У-183` (модель, сервис, уведомление), `У-186`, `У-187` | `prisma/schema.prisma`, `prisma/migrations/*`, `src/lib/auth/accessProfileSchema.ts`, `src/lib/auth/accessProfile.ts`, `src/components/access/role-editor.tsx`, `src/lib/services/contacts/*`, `src/lib/services/organizationNotes/*`, `src/lib/notifications/{registry,noteMention}.ts`, `src/lib/services/manager/dealNotes.ts`, `src/lib/pii/contexts.ts`, `src/lib/auth/audit.ts`, `src/lib/audit/labels.ts`, `src/lib/errors/messages.ts`, `src/__tests__/contacts.*`, `src/__tests__/organizationNotes.*` |
| **PR-2 «экраны контактов»** (Task 2) | `SectionKey`/значок/меню в трёх кабинетах; страницы списка и карточки ×3; `components/contacts/*` (список, карточка, форма, каналы, объединение); server actions; категория поиска; `preselect` у «Нового диалога»; `createLeadFromContact`; эталоны Playwright (список и карточка, 1280 и 390); глоссарий «Контакт», «Объединение контактов» | `У-178`, `У-179` (без вкладки задач), `У-180` (UI), `У-181` (UI, редирект), `У-185` | `src/lib/navigation/{sectionLabels,icons,cabinet}.ts`, `src/app/{manager,leader,admin}/contacts/**`, `src/components/contacts/*`, `src/server-actions/contacts.ts`, `src/lib/services/search/{globalSearch,scopes}.ts`, `src/components/manager/messengers/new-dialog-button.tsx`, `src/lib/services/intake/convert.ts`, `src/e2e/snapshots/contacts.spec.ts`, `docs/glossary.md`, `src/lib/help/glossary.ts` |
| **PR-3 «карточка организации, лид, заказ, сделка»** (Task 3) | вкладки `contacts` и `notes` в реестре; секции «Контакты» и «Заметки»; `mention-textarea` извлечён из чата команды; «Важное» на «Обзоре»; `orgHistory.ts` и переписанная вкладка «История» (`auditTrail` из карточки убран); блоки «Контакт» в лиде, заказе и сделке; глоссарий «Заметка (внутренняя)» | `У-182`, `У-183` (UI), `У-184`, `У-180` («из всех точек») | `src/lib/navigation/orgCardTabs.ts`, `src/components/manager/org-card-tabs.tsx`, `src/components/organization/org-{contacts,notes}-section.tsx`, `src/components/ui/mention-textarea.tsx`, `src/components/staff-chat/staff-composer.tsx`, `src/lib/services/organization/orgHistory.ts`, `src/lib/services/manager/organizationCard.ts`, `src/app/{manager,leader,admin}/organizations/[id]/page.tsx`, `src/app/manager/leads/[id]/page.tsx`, карточки заказа и сделки, `src/server-actions/organizationNotes.ts` |
| **PR-4 «флаг и close-out»** (Task 4) | флаг во всех точках (страж `third-gate`), матрица флагов, `AUDIT.md` (`У-178`…`У-187` ✅ с якорями), `STATUS.md` (этап 1 ✅, «Текущий этап» → 2), close-out плана, CHANGELOG, `tz:status` | `У-178` (флаг) и закрытие этапа | `src/lib/featureFlags.ts` (комментарий), `docs/feature-flags-matrix.md`, `docs/tz/{AUDIT,STATUS}.md`, `docs/superpowers/plans/2026-09-12-stage1-contacts-and-notes-DONE.md`, `CHANGELOG.md` |

Если PR-2 разрастётся (карточка контакта с шестью вкладками — самый большой кусок), он делится на 2a «список, форма, поиск» и 2b «карточка, объединение, «Написать»/«Создать лид»» — порядок и требования те же.

## 5. Тестовая стратегия

- **Unit (mock-prisma):** скоуп — матрица эквивалентности Prisma-формы и in-memory (`manager` own/team, `leader`, `admin`, без компании, чужая компания, контакт без организации); `mutate.ts` — занятый канал → `contact_channel_taken` с именем владельца, гонка `P2002` → тот же код, канал пользователя кабинета → `contact_channel_locked`; `merge.ts` — отказы (сам с собой, два `userId`, главный уже объединён), перенос `position`/`note` только в пустое; заметки — окно 24 ч, лимит закреплённых, длина, роли правки/удаления; `noteMention` — упомянутый получает `note_mention` с `entity`, автор себя не получает, несуществующее имя игнорируется; поиск — нормализация телефона из «+7 (921) 123-45-67» и «8921…»; `orgHistory` — слияние по времени, `total` = сумма, фильтр по типу даёт точные `skip/take`, выключенные флаги убирают источник.
- **Integration (живой Postgres, маркер режима):** объединение переносит **все** связи в транзакции (каналы, диалоги, звонки, письма, заказы, сделки, `userId`) и откатывается целиком при сбое; редирект старого id; заметка с упоминанием создаёт `Notification` и правило `note_mention` срабатывает после миграции (строка `deal_note_mention` в `NotificationRule` переехала); `crm.contacts` дописан существующим профилям; `PiiAccessEvent` пишется при открытии карточки и списка.
- **Стражи (каждый проверяется мутацией: сломать → красный → вернуть):** IDOR — партнёр, заказчик, чужая компания → `not_found` на `get`/`list`/каждую мутацию контактов и заметок; `teamMode` — регулярка ловит и `teamMode = false`, и `teamMode: boolean = false` в `services/contacts/*`; `pii.capture-coverage` — три контекста в своих `callSite`; `notifications.registry` — `note_mention` в `noteMention.ts`, `deal_note_mention` не встречается ни в одном продьюсере; `navigation.mirror` — «Контакты» в трёх кабинетах без исключений; `navigation.org-card-tabs` — порядок с `contacts` и `notes`; `security.role-access-matrix` — новые предикаты (`canSeeContact`) описаны для шести ролей; `featureFlags.third-gate` — страницы `contacts` читают флаг; `pages.subtitles` — `PageHeader` на всех новых экранах; `help.glossary` — «Контакт», «Заметка (внутренняя)», «Объединение контактов» обязательны; `docs.feature-flags-matrix` — строка `contacts` одна и актуальна.
- **Компоненты (RTL):** форма контакта показывает подсказку занятого канала с двумя кнопками; диалог объединения не даёт выбрать сам контакт; композитор заметки подсказывает имена после `@` и вставляет `@Имя `; лента истории показывает «Показаны N из M».
- **Playwright-эталоны:** `/manager/contacts` (список с данными и пустой), `/manager/contacts/[id]`, вкладки «Контакты» и «Заметки» карточки организации — 1280×800 и 390×844; снимаются на свежей seed-базе (сид уже делает бэкфилл контактов).
- **Гейты каждого PR:** `npm run typecheck` · `lint` · `test:unit` · интеграционные тесты затронутых сервисов · покрытие новых файлов 100 % адресно · `boundaries` · `deadcode` · `dup:check` · `format:check` · `tz:status` · `npm run build` (урок 28.08: тесты зелёные, а сборка сломана двое суток).

## 6. Риски

1. **Дубли всплывут сразу.** Контакты создавались автоматически из входящих и звонков; при включении экрана заказчик увидит «Иванов» трижды. Объединение едет в том же этапе (PR-2), а список умеет сортировать по имени, чтобы дубли стояли рядом.
2. **Обобщение `deal_note_mention → note_mention`** меняет ключ правил: миграция переносит строки `NotificationRule`, псевдоним в реестре сохраняет подписи исторических уведомлений. Проверяется интеграционным тестом «правило срабатывает после миграции».
3. **Извлечение `mention-textarea` трогает чат команды** — регресс ловят существующие тесты `staff-composer`; компонент переносится без изменения поведения, тем же PR.
4. **`getOrganizationCard` теряет `auditTrail`** — компоненты и тесты, читающие это поле, обновляются в PR-3; `typecheck` не даст пропустить.
5. **Объём PR-2.** Резерв — деление на 2a/2b (§4).
6. **`Deal.contactId` без relation:** `updateMany` по строке безопасен, но целостность (сделка ссылается на удалённый контакт) не защищена базой — контакты не удаляются (только архив), поэтому битых ссылок не появится; relation — кандидат в этап 9.

## 7. Вопросы заказчику (умолчания действуют, если не отменены до кода)

| № | Вопрос | Умолчание |
|---|---|---|
| В-1-1 | Контакт **без организации** («с улицы») — виден всей команде компании или только тому, кто его создал? | всей команде: закреплять его не за что, а невидимый контакт хуже видимого |
| В-1-2 | Право `crm.contacts` **дописать всем существующим профилям** (никто не потеряет раздел) или оставить выключенным, чтобы админ раздал вручную? | дописать миграцией |
| В-1-3 | Удалять заметки — только руководитель и администратор, менеджер даже свою не может (пакет 04 §8) — так и оставить? | да; менеджер правит свою 24 часа, удалить не может |
| В-1-4 | «История» при фильтре «Все типы» показывает верх ленты и предлагает выбрать тип для глубины (§3.8) — приемлемо, или нужна сквозная постраничность по всем источникам (потребует объединяющей таблицы событий — отдельный объём)? | верх + фильтр |
| В-1-5 | У администратора кнопки «Написать» в карточке контакта нет (`Р-М-5`: переписку он не ведёт) — подтвердить? | нет кнопки, причина в коде |
| В-1-6 | Объединять два контакта, у каждого из которых есть пользователь кабинета, — запрещаем (это два человека) или переносим второго пользователя вручную? | запрещаем с русской подсказкой |
| В-1-7 | Подпись охвата «Заявки» в редакторе ролей (попутная находка §1) — чиним хотфиксом §9.4 отдельно от этапа? | да, отдельным хотфиксом после PR-1 |
