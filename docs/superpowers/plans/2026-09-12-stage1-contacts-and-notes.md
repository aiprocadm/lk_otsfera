# Этап 1 «Контакты и внутренние заметки» — план

Спека — [2026-09-12-stage1-contacts-and-notes-design.md](../specs/2026-09-12-stage1-contacts-and-notes-design.md)
(предъявлена 12.09.2026, PR [#585](https://github.com/aiprocadm/lk_otsfera/pull/585);
подтверждена мержем спеки; семь умолчаний §7 действуют, пока заказчик не
отменил). Требования `У-178`…`У-187` действующего
[ТЗ «CRM для отдела продаж — замена Битрикс24»](../../tz/2026-09-12-tz-crm-bitrix-replacement.md),
тексты — пакет [04_crm_core.md](../../specs/04_crm_core.md), порядок задач —
[15 Task 1…4](../../specs/15_claude_code_tasks.md).

REQUIRED SUB-SKILL: superpowers:subagent-driven-development

## Разбивка

| PR | Что | Требования | Статус |
|---|---|---|---|
| PR-1 «основа» | Миграция (`OrganizationNote`, `Contact.mergedIntoId`, перенос правил `deal_note_mention → note_mention`, `crm.contacts` дописан существующим профилям); право `crm.contacts` в схеме профиля и редакторе ролей; `services/contacts/{scope,list,get,mutate,merge}.ts`; `services/organizationNotes/{list,mutate}.ts`; `notifications/noteMention.ts` и реестр (`note_mention`, псевдоним старого ключа); три контекста ПДн и `subjectType: contact`; аудит-действия и подписи; коды ошибок; стражи IDOR / `teamMode` / эквивалентность скоупа | `У-180` (сервис), `У-181` (сервис), `У-183` (модель, сервис, уведомление), `У-186`, `У-187` | ⏳ |
| PR-2 «экраны контактов» | `SectionKey` `contacts`, значок, пункт меню в трёх кабинетах; страницы списка и карточки ×3; `components/contacts/*`; server actions; категория поиска; `preselect` у «Нового диалога»; `createLeadFromContact`; эталоны Playwright; глоссарий «Контакт», «Объединение контактов» | `У-178`, `У-179` (без вкладки задач), `У-180` (UI), `У-181` (UI, редирект), `У-185` | ⏳ |
| PR-3 «карточка организации, лид, заказ, сделка» | Вкладки `contacts` и `notes` в реестре; секции; `mention-textarea` извлечён из чата команды; «Важное» на «Обзоре»; `orgHistory.ts` и вкладка «История» с фильтром и «Показаны N из M» (`auditTrail` из карточки убран); блоки «Контакт» в лиде, заказе и сделке; глоссарий «Заметка (внутренняя)» | `У-182`, `У-183` (UI), `У-184`, `У-180` («из всех точек») | ⏳ |
| PR-4 «флаг и close-out» | Флаг `contacts` во всех точках (страж `third-gate`), матрица флагов, `AUDIT.md` (`У-178`…`У-187` ✅ с якорями), `STATUS.md` (этап 1 ✅, «Текущий этап» → 2), close-out, CHANGELOG | `У-178` (флаг), закрытие этапа | ⏳ |

**Порядок обязателен:** PR-1 → PR-2 → PR-3 → PR-4. PR-2 читает сервисы PR-1,
PR-3 — сервисы заметок PR-1 и страницы PR-2, PR-4 закрывает флаг после
появления всех его точек чтения. Если PR-2 разрастётся — делится на 2a
«список, форма, поиск» и 2b «карточка, объединение, «Написать» / «Создать
лид»» (§4 спеки).

Гейты на каждый PR: `npm run typecheck` · `npm run lint` · `npm run test:unit`
· интеграционные тесты затронутых сервисов против живого Postgres · покрытие
новых файлов 100 % (`npx vitest run --coverage` адресно) · `npm run boundaries`
· `npm run deadcode` · `npm run dup:check` · `npm run format:check` ·
`npm run tz:status` · `npm run build` · запись в `CHANGELOG.md`. Каждый новый
страж проверен мутацией (сломать → красный → вернуть → зелёный) и упомянут в PR.

## PR-1 «основа» — сервер готов, пользователь ничего не видит

- [ ] `prisma/schema.prisma`: `OrganizationNote` (связи на `Company`,
      `Organization`, `User`), `Contact.mergedIntoId` + self-relation
      `ContactMerged`; обратные связи `organizationNotes` у трёх моделей
- [ ] миграция `stage1_contacts_notes` (аддитивная, с комментарием «зачем» и
      обратным SQL в комментарии): таблица, колонка, индексы; `UPDATE
      NotificationRule eventType deal_note_mention → note_mention`; `UPDATE
      AccessProfile SET capabilities = array_append(...)` где `crm.contacts`
      ещё нет; `npx prisma migrate status` чисто
- [ ] `auth/accessProfileSchema.ts`: `'crm.contacts'` в `capabilitySchema`;
      `components/access/role-editor.tsx`: подпись «Контакты (справочник)»;
      `auth/accessProfile.ts` `can()` — без изменений семантики (нет профиля →
      deny для новых прав; страницы и сервисы контактов зовут `canUseContacts`,
      который трактует no-profile как «можно», §3.2 спеки)
- [ ] `services/contacts/scope.ts`: `contactScopeWhere(session, teamMode)` и
      `isContactInScope(session, teamMode, contact)`; `canUseContacts(session)`
- [ ] `services/contacts/list.ts`: поиск (имя, организация, e-mail, телефон в
      любом написании), фильтры, сортировка, постраничность 50 с `total`,
      `recordPiiAccess('contacts_list')`
- [ ] `services/contacts/get.ts`: карточка с каналами, организацией, связями по
      вкладкам (счётчики), `mergedIntoId` для редиректа,
      `recordPiiAccess('contact_card')`
- [ ] `services/contacts/mutate.ts`: `updateContact`, `archiveContact`,
      `restoreContact`, `addChannel`, `removeChannel`, `setPrimaryChannel`;
      занятый канал → `contact_channel_taken` с владельцем; канал пользователя
      кабинета → `contact_channel_locked`; аудит
- [ ] `services/contacts/merge.ts`: `mergeContacts` — отказы (`contact_merge_self`,
      `contact_merge_two_users`, `contact_merge_target_merged`), транзакция
      переноса (каналы, письма, звонки, диалоги, заказы, сделки, `userId`,
      пустые `position`/`note`), архив + `mergedIntoId`, аудит `contact_merged`
      со снимком; `listMergeCandidates`
- [ ] `services/organizationNotes/{list,mutate}.ts`: список (закреплённые
      сверху), `addNote`, `editNote` (автор 24 ч, руководитель/админ всегда),
      `removeNote` (руководитель/админ, аудит), `pinNote`/`unpinNote` (до трёх);
      `note_too_long`, `note_pin_limit`, `note_edit_expired`; партнёр и
      заказчик → `not_found`
- [ ] `notifications/noteMention.ts`: `notifyNoteMention({ entity, ... })` —
      единый продьюсер `note_mention`; `manager/dealNotes.ts` переведён на него;
      реестр: `note_mention` вместо `deal_note_mention`, `LEGACY_TYPE_ALIASES`
      для подписей исторических строк
- [ ] `pii/contexts.ts`: `subjectType` `contact`; контексты `contact_card`,
      `contacts_list`, `contacts_search`; `admin/piiAccess.ts` — подпись
      субъекта-контакта по имени
- [ ] `auth/audit.ts` + `audit/labels.ts`: `contact_updated`, `contact_archived`,
      `contact_restored`, `contact_channel_added`, `contact_channel_removed`,
      `contact_merged`, `organization_note_created`, `organization_note_updated`,
      `organization_note_deleted`, `organization_note_pinned`; сущность
      `organization_note`
- [ ] `errors/messages.ts`: восемь новых кодов с русскими строками
- [ ] тесты: unit на каждый сервис (mock-prisma), матрица эквивалентности
      скоупа, `auth.teamMode-required.guardrail` расширен на `services/contacts`
      и `services/organizationNotes`, IDOR-стражи (партнёр / заказчик / чужая
      компания → `not_found` на каждую функцию), integration: объединение
      переносит все связи и откатывается целиком, правило `note_mention`
      срабатывает после миграции, `crm.contacts` дописан профилям,
      `PiiAccessEvent` пишется
- [ ] `CHANGELOG.md`

## PR-2 «экраны контактов» — три зеркальных раздела и карточка

- [ ] `navigation/sectionLabels.ts` (`contacts` → «Контакты»), `icons.ts`
      (`contacts`), `cabinet.ts` — пункт в группе «Клиенты» после
      «Организации» у manager/leader/admin с `flag: 'contacts'`
- [ ] страницы `/{manager,leader,admin}/contacts/page.tsx` и `[id]/page.tsx`:
      гард роли, `notFound()` при выключенном флаге или без `canUseContacts`,
      `PageHeader` с подзаголовком, крошки, редирект по `mergedIntoId`
- [ ] `components/contacts/contact-list.tsx` (таблица → карточки на 390),
      `contact-filters.tsx`, `contact-form-dialog.tsx` (подсказка занятого
      канала с «Открыть» / «Объединить»), `contact-card.tsx` (шапка, каналы,
      вкладки Диалоги · Звонки · Входящие письма · Сделки · Заказы · История,
      пустые состояния с действием), `contact-channels.tsx`,
      `merge-contacts-dialog.tsx`
- [ ] `server-actions/contacts.ts`: `createContactAction`, `updateContactAction`,
      `archiveContactAction`, `restoreContactAction`, `addChannelAction`,
      `removeChannelAction`, `setPrimaryChannelAction`, `mergeContactsAction`,
      `createLeadFromContactAction`; флаг → `forbidden`; `revalidatePath` трёх
      кабинетов
- [ ] `services/intake/convert.ts`: `createLeadFromContact` (источник `manual`)
- [ ] `components/manager/messengers/new-dialog-button.tsx`: проп `preselect`;
      страница `/manager/messengers` читает `?new=<contactId>`
- [ ] `services/search/{scopes,globalSearch}.ts`: категория `contacts`,
      нормализация телефона из запроса, `recordPiiAccess('contacts_search')`
- [ ] `docs/glossary.md` + `lib/help/glossary.ts`: «Контакт», «Объединение
      контактов»
- [ ] `src/e2e/snapshots/contacts.spec.ts`: список (с данными, пустой),
      карточка — 1280×800 и 390×844
- [ ] тесты: страницы (`renderServerComponent`), компоненты (RTL), server
      actions (моки), `pages.subtitles`, `navigation.mirror`,
      `navigation.same-section-same-name`, `security.role-access-matrix`
- [ ] `CHANGELOG.md`

## PR-3 «карточка организации, лид, заказ, сделка»

- [ ] `navigation/orgCardTabs.ts`: `contacts` (после «Сотрудники», STAFF, флаг
      `contacts`) и `notes` (после «Комментарии», STAFF) с причиной в
      комментарии; страж порядка обновлён
- [ ] `components/ui/mention-textarea.tsx` извлечён из `staff-composer.tsx`
      (чат команды переведён на него, поведение не меняется)
- [ ] `components/organization/org-contacts-section.tsx`,
      `org-notes-section.tsx` (композитор, закреплённые сверху, правка своей,
      удаление руководителем), блок «Важное» на «Обзоре»
- [ ] `services/organization/orgHistory.ts`: `listOrgHistory` — пять
      источников, фильтр по типу, точная постраничность в типе, «верх + сумма»
      для «Все типы», источники под выключенными флагами не грузятся;
      `getOrganizationCard` теряет `auditTrail`; вкладка «История» переписана
- [ ] страницы карточки ×3 грузят секции только при активной вкладке; плитка
      «Контакты» = не архивные
- [ ] `server-actions/organizationNotes.ts`: `add`, `edit`, `remove`, `pin`,
      `unpin`; `revalidatePath` карточек трёх кабинетов
- [ ] карточка лида: блок «Контакт» (`resolveContactByChannel`) + «Создать
      контакт из данных лида»; карточка заказа: «Контакт заказа»
      (`setOrderPrimaryContact`); карточка сделки: «Контакт» (`Deal.contactId`)
- [ ] `docs/glossary.md` + `lib/help/glossary.ts`: «Заметка (внутренняя)»
- [ ] тесты: `orgCard.tabs-registry`, вкладок нет у партнёра/заказчика,
      руководитель удаляет чужую заметку — менеджер нет, лента листается,
      `jscpd` не выше порога
- [ ] `CHANGELOG.md`

## PR-4 «флаг и close-out»

- [ ] `featureFlags.ts`: комментарий флага `contacts` — точки чтения; страницы
      читают флаг сами (страж `featureFlags.third-gate` зелёный)
- [ ] `docs/feature-flags-matrix.md`: строка `contacts` переписана
- [ ] `docs/tz/AUDIT.md`: `У-178`…`У-187` ✅ с якорями и датой;
      `docs/tz/STATUS.md`: этап 1 ✅, «Текущий этап» → 2 «Миграция из
      Битрикс24», шаг — спека
- [ ] close-out `2026-09-12-stage1-contacts-and-notes-DONE.md`
- [ ] `CHANGELOG.md`; `npm run tz:status`
