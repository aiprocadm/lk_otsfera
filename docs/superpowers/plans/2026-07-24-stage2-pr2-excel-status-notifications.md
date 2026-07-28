# План — Этап 2 / PR-2: Excel-импорт, статусная лента, дашборды, уведомления

Спека: [2026-07-23-stage2-enrollment-wizard-design.md](../specs/2026-07-23-stage2-enrollment-wizard-design.md) §3 (Excel), §4 (lifecycle), §5, §6, §9 (PR-2) — ✅ подтверждена.
База: PR-1 ([#218](https://github.com/aiprocadm/lk_otsfera/pull/218), смержен) — модель шапка+позиции,
мастер 3 шага, статусы `in_training`/`certificates_ready` уже в enum + бейджах.

Отступление от спеки (техническая деталь, решений заказчика не меняет): парсинг
Excel — **на сервере** через server-action (паттерн admin payments-import:
`loadXlsxWorkbook`/exceljs), а не на клиенте — спека ошибочно считала клиентский
парсинг существующим паттерном. Контракт для пользователя тот же: файл → валидные
строки в таблицу мастера, невалидные — списком русских ошибок «Строка N: …».

Уточнение: уведомления `enrollment_submitted` менеджерам, которое спека
предполагала «сохранить», в коде нет (подача никого не уведомляет) — добавляем
его в этом PR вместе с `enrollment_status_changed`.

REQUIRED SUB-SKILL: superpowers:subagent-driven-development (по желанию).

## A. Excel-импорт (ФТ-2.1, шаг 2 мастера)

- [x] A1. `GET /api/enrollments/import-template` — xlsx-шаблон (exceljs, по образцу
  `commission/xlsx.ts`, `safeText`): колонки ФИО*, Email*, Должность, СНИЛС,
  Дата рождения, Дополнительно + строка-пример; отдаётся inline attachment
  (без S3), под сессией + `notFoundIfDisabled('enrollment_requests')` +
  `canSubmitEnrollments`.
- [x] A2. Сервис `enrollments/importRows.ts`: `parseEnrollmentImportWorkbook(buffer)`
  — чтение первого листа (`loadXlsxWorkbook` + header-маппинг как
  `parse-workbook.ts`), нормализация дат (Date/serial/строка `ДД.ММ.ГГГГ`/ISO),
  построчная валидация через `validateEnrollmentItems` с label «Строка N»;
  результат `{rows: ValidatedItem[], errors: string[]}`.
- [x] A3. Server-action `parseEnrollmentImportAction(formData)` (тонкий адаптер:
  сессия, `canSubmitEnrollments`, size/mime-гейт, вызов A2).
- [x] A4. Мастер, шаг 2: блок «Импорт из Excel» — «Скачать шаблон» (ссылка на A1),
  input file → action A3, валидные строки добавляются в таблицу позиций
  (`WizardRow`), ошибки — списком; дубликаты email против уже набранных строк
  склеиваются с предупреждением (существующая клиентская валидация).

## B. Lifecycle-переходы по позициям (ФТ-2.3, решение §10-4)

- [x] B1. `lifecycle.ts`: `advanceEnrollmentItems(prisma, {id, reviewerId, target:
  'in_training'|'certificates_ready', itemIds?})` — bulk по выбранным позициям
  (или всем не-rejected); гейт: каждая позиция строго на предыдущем шаге
  конвейера (`provisioned→in_training→certificates_ready`), иначе
  `lifecycle_violation`; пустой выбор → `validation`.
- [x] B2. Агрегация шапки (§2 спеки): после перехода статус шапки = минимальный
  по конвейеру статус не-rejected позиций (все rejected → rejected); helper
  `aggregateHeaderStatus(items)` — чистая функция + вызов в транзакции B1.
  Аудит `enrollment_items_advanced` (счётчики, без ПДн).
- [x] B3. `PATCH /api/enrollments/[id]`: новые `action: 'markInTraining' |
  'markCertificatesReady'` (+ `itemIds?: string[]`) в существующем свитче.
- [x] B4. `enrollment-queue.tsx`: в раскрытии позиций — чекбоксы позиций;
  для `provisioned`+ заявок кнопки «Идёт обучение» / «Удостоверения готовы»
  (выбранные или все подходящие позиции).

## C. Деталка подателя + статусная лента (ФТ-2.3) + удостоверения

- [x] C1. Сервис `enrollments/detail.ts`: `getEnrollmentRequest(prisma, session, id)`
  — scope как `scopeWhere` списка; позиции + направление + для позиций со
  `studentId` при статусе `certificates_ready` — `Certificate` по
  (studentId, directionId, documentId != null) → `certificateDocumentId`;
  `recordPiiAccess` (контекст `enrollment_detail`).
- [x] C2. Компонент `enrollment-status-ribbon.tsx` — лента 5 точек по русским
  подписям бейджа («подана → принята → зачислены → идёт обучение →
  удостоверения готовы»); rejected — отдельное состояние с причиной.
- [x] C3. Страницы `organization/enrollments/[id]/page.tsx` и
  `partner/enrollments/[id]/page.tsx` (sibling, flag-guard + canSee-чек):
  лента C2, таблица позиций со статус-бейджами, «Скачать удостоверение»
  (существующий download-роут документов роли) при наличии; пустые
  состояния/подсказки (ФТ-2.6).
- [x] C4. `enrollment-list.tsx`: строка — ссылка на деталку (для ролей, где
  деталка есть: organization/partner).

## D. Дашборды (ФТ-2.4)

- [x] D1. Сервисы дашбордов org/partner: `recentEnrollments(prisma, scope, 5)` —
  последние 5 заявок (направление, статус, дата, число слушателей).
- [x] D2. Sibling-блоки `org-enrollments-card.tsx` / `partner-enrollments-card.tsx`:
  кнопка «Подать заявку на обучение» (→ `/…/enrollments`) + «Последние заявки»
  со статус-бейджами и ссылками на деталку; пустое состояние (ФТ-2.6).

## E. Уведомления (ФТ-2.5)

- [x] E1. Тип `enrollment_status_changed` подателю: helper
  `notifySubmitterEnrollmentStatus(db, {request, target})` в
  `src/lib/notifications/` — `createNotification` + `deliverNotificationToUser`
  (submittedByUserId, мультиканально, generic email-шаблон `notification`);
  текст: «Заявка на обучение: N слушателей, направление X — статус „…“»;
  `meta.url` → деталка по роли подателя. Best-effort (§3): сбой логируется,
  переход не блокирует.
- [x] E2. Вызовы E1 из lifecycle: approve / reject / markProvisioned /
  переходы B1, когда статус шапки изменился.
- [x] E3. `enrollment_submitted` менеджерам при подаче (submit.ts, best-effort):
  по `notifyManagersOrderLess`-паттерну для организации заявки; для заявки
  без организации — без fan-out (некому адресовать).

## F. Тесты (порог 100%) и ворота

- [x] F1. importRows: маппинг колонок, даты (serial/строки), «Строка N: …»-ошибки,
  пустые строки/лист; server-action: гейты, mime/size. Роут шаблона: заголовки,
  колонки (парс результата exceljs), гейты.
- [x] F2. lifecycle B1/B2: конвейер, bulk выбранных/всех, lifecycle_violation,
  агрегация шапки (unit-таблица + integration на живой БД).
- [x] F3. detail: скоупы (чужая заявка → not_found), certificate-ссылки.
- [x] F4. Уведомления: enrollment_status_changed на каждый переход, best-effort
  (сбой канала не валит переход), enrollment_submitted при подаче.
- [x] F5. UI: импорт-блок мастера, ribbon, деталки (renderServerComponent),
  дашборд-карточки, кнопки очереди; обновить существующие тесты queue/list.
- [x] F6. `typecheck` / `lint` / `test:unit` зелёные; integration по затронутым
  местам на живом Postgres. CHANGELOG.md; STATUS.md; PR.
