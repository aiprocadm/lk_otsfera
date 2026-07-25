# Этап 5 ТЗ — заявки клиентов + DaData в формах (Модуль 1, ФТ-13.3–13.4)

Дата: 2026-07-24 · Статус: **✅ подтверждена заказчиком 24.07.2026** («ок по
этапу 5»: (1) `/partner/leads` закрывается redirect'ом на `/partner/requests`,
история — через заказы; (2) состав полей формы — как в §3; (3) статусы —
«подана → в работе → принята/отклонена»; (4) 2 PR) ·
ТЗ: [docs/tz/2026-07-23-tz-lk-otsfera-v1.md](../../tz/2026-07-23-tz-lk-otsfera-v1.md) §Модуль 1, ФТ-13.3–13.4, §9 этап 5.

**Решение по вопросу 4 §10 ТЗ** (заказчик делегировал 24.07.2026 — «не знаю»):
источник `website` — **задел на будущее**: значение резервируется в enum
источников, приём вебхуком с внешнего сайта в этап не входит (добавится
отдельным PR, когда появится реальный сайт-источник).

## 1. Цель и критерий приёмки (§9 ТЗ)

«Партнёр не может создать Lead ни через UI, ни через API; заявка проходит
путь подача → триаж → лид; антидубль виден только сотрудникам».

## 2. Модель данных (ФТ-1.1)

**`ClientRequest` (новая)** — заявка клиента общего вида:

```
id, createdAt, updatedAt
source          ClientRequestSource  — partner_cabinet | organization_cabinet | website (задел)
submittedByUserId FK → User          — податель
partnerId       String?              — принадлежность (по роли подателя)
organizationId  String?
companyName     String               — со слов клиента
inn             String?              — не проверяется на дубли на клиентской стороне (ФТ-13.4)
contactName     String
contactPhone    String?
contactEmail    String?
subject         String               — тема/что нужно
body            String?              — описание
status          ClientRequestStatus  @default(submitted) — submitted | in_triage | converted | rejected
triagedByUserId String?; triagedAt DateTime?; rejectedReason String?
convertedLeadId String? @unique      — созданный из заявки лид
attachments     ClientRequestAttachment[]
@@index([status]) @@index([partnerId]) @@index([organizationId]) @@index([submittedByUserId])
```

**`ClientRequestAttachment`** — по образцу `LeadAttachment` (S3-путь, MIME/size
гейты, `scanStatus pending→clean|infected`, скан-очередь, presigned download).

**Миграция `Lead`** (additive, данные не теряем): `partnerId` → nullable;
`+source LeadSource @default(partner_legacy)` (`partner_legacy | client_request |
manual | website`); `+sourceRequestId String? @unique`. Существующие лиды
получают `partner_legacy`.

## 3. Подача (ФТ-1.2, 1.3)

- Флаг **`client_requests`** (opt-in, три точки: middleware + nav + page/route).
- `/partner/requests` и `/organization/requests` — sibling-страницы: форма
  подачи (компания, ИНН — ручной ввод + DaData-подсказка §6, контакт, тема,
  описание, вложения) + список своих заявок со статус-бейджами
  (`подана → в работе → принята/отклонена`) и деталкой.
- Сервис `clientRequests/submit.ts`: скоупы по роли подателя (partner —
  свой partnerId; organization — своё членство), транзакция заявка+вложения,
  аудит (счётчики, без ПДн), уведомление менеджерам best-effort
  (`client_request_submitted`, паттерн enrollment_submitted) + статусные
  уведомления подателю при триаже (`client_request_status_changed`).

## 4. Триаж у сотрудников (ФТ-1.4) и запрет партнёрских лидов (ФТ-1.5–1.7)

- `/manager/requests` (+ зеркала leader/admin): очередь заявок
  (company-scope по C8-паттерну inbox), деталка, действия:
  - **«Принять → создать лид»**: транзакция — Lead из полей заявки
    (`source: client_request`, `sourceRequestId`, `partnerId` наследуется),
    статус заявки `converted`; антидубль-плашка ДО создания (§7);
  - **«Отклонить»** с причиной; статус `rejected`.
- **Запрет партнёрского создания лидов**: `createLead` (partner) и
  `POST /api/partner/leads` → `forbidden` (410-семантика UI: раздел закрыт);
  `/partner/leads*` — redirect на `/partner/requests`; nav-пункт партнёра
  «Заявки» ведёт на requests; флаг `partner_leads` удаляется из точек чтения
  (сам раздел менеджера остаётся). Нав менеджера: «Заявки» → «Лиды»,
  новый пункт «Обращения клиентов» → `/manager/requests`.
- Новый сервис создания лида **сотрудником** (`manual` источник) — только
  manager/leader/admin (Result `forbidden` для прочих) + форма в
  `/manager/leads` с антидубль-плашкой §7.

## 5. Вложения

Как у лидов: MIME allow-list, лимит размера, `docs.scanDocument`-очередь,
infected → 410, presigned download; вложения заявки видят податель и staff.

## 6. DaData-подсказки в формах (ФТ-13.3)

- Новый переиспользуемый клиентский компонент `PartyAutocomplete`
  (потребитель готового `GET /api/suggest/party`): ввод названия/ИНН →
  выпадающие подсказки → выбор автозаполняет name/inn/kpp/ogrn/адрес;
  деградация до ручного ввода при пустом ответе (интеграция выключена).
- Встраивается: формы подачи заявки (partner/organization), создание и
  редактирование организации у сотрудников (`create-organization-dialog`,
  `admin-organization-edit-form`), форма создания лида сотрудником.
  (Формы реквизитов — этап 8, компонент переиспользуют там.)

## 7. Антидубли — только внутренняя сторона (ФТ-13.4)

- Общий сервис `duplicates/findByInn.ts` (staff-only RBAC): по ИНН ищет
  Organization (+ активные лиды) → `{ kind, id, name }[]`.
- Плашка «Уже есть в базе: [название]» со ссылкой на карточку и предложением
  «Привязать» — в триаже заявки (привязка organizationId к лиду), в создании
  лида сотрудником и в создании организации (существующая блокирующая
  `inn_exists` становится неблокирующей плашкой с найденной организацией;
  unique-констрейнт БД остаётся последним рубежом).
- Клиентским ролям факт существования ИНН **не раскрывается**: формы подачи
  не зовут duplicate-чек; endpoint — за staff-гейтом.

## 8. Тестовая стратегия (порог 100%)

- submit: скоупы ролей, транзакционность, вложения-гейты (unit + integration).
- Триаж: принять→лид (source/sourceRequestId/converted), отклонить, C8-скоуп
  очереди, `forbidden` для партнёра в createLead/API (критерий приёмки).
- Миграция Lead: partner_legacy бэкфилл, nullable partnerId (integration).
- PartyAutocomplete: подсказки/выбор/автозаполнение/деградация (jsdom).
- findByInn: staff-only, org+lead выдача; плашки в формах; клиентские формы
  не зовут чек (guard-тест).
- Уведомления: submitted менеджерам, статусные подателю, best-effort.
- Страницы/нав/redirect: renderServerComponent + navigation-тесты.

## 9. Вопросы заказчику (до кода)

1. **Судьба партнёрских лидов в UI**: раздел `/partner/leads` закрываем
   redirect'ом на `/partner/requests` (моё предложение), а история старых
   лидов партнёру остаётся видна только через заказы? Или оставить партнёру
   read-only список его старых лидов?
2. **Поля формы заявки**: компания, ИНН (необязательный), контактное лицо,
   телефон/email (хотя бы одно), тема, описание, вложения — достаточно?
3. **Статусы заявки**: submitted → in_triage → converted/rejected с русскими
   подписями «подана → в работе → принята/отклонена» — ок?
4. **Разбивка**: 2 PR — PR-1 «модель + подача + триаж + запрет партнёрских
   лидов» (критерий этапа закрыт), PR-2 «DaData-автокомплит + антидубли-плашки»
   — ок?

## 10. Вне скоупа этапа 5

- Вебхук website (решение §10-4 — задел; отдельным PR при появлении сайта).
- Агрегатор `/manager/intake` (Модуль 8 — этап 7).
- Формы реквизитов (Модуль 9 — этап 8; PartyAutocomplete переиспользуют).
- SLA-таймеры триажа (этап 7).
