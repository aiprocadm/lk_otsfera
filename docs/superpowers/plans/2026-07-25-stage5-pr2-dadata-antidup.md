# План — Этап 5 / PR-2: DaData-автокомплит в формах + антидубли-плашки

Спека: [2026-07-24-stage5-client-requests-design.md](../specs/2026-07-24-stage5-client-requests-design.md) §6–7, §9 (PR-2) — ✅ подтверждена.
База: PR-1 (#224) — заявки клиентов, триаж, запрет партнёрских лидов.
Закрывает ФТ-13.3 (подсказки) и ФТ-13.4 (антидубли — только внутренняя сторона).

REQUIRED SUB-SKILL: superpowers:subagent-driven-development (по желанию).

## A. PartyAutocomplete (ФТ-13.3)

- [ ] A1. Клиентский компонент `src/components/party/party-autocomplete.tsx`
  ('use client', domain-agnostic — сознательно общий): ввод названия/ИНН →
  debounce 300мс → `GET /api/suggest/party?query=` → выпадающий список
  (название, ИНН, адрес); выбор → `onSelect({name, inn, kpp, ogrn, address})`;
  пустой ответ/выключенная интеграция → деградация до обычного инпута без
  ошибок; клавиатурная навигация (стрелки+Enter+Escape), aria-combobox.
- [ ] A2. Встраивание: `client-request-form.tsx` (поле «Название компании» —
  выбор автозаполняет ИНН), `lead-create-staff-form.tsx` (то же),
  `create-organization-dialog.tsx` и `admin-organization-edit-form.tsx`
  (название+ИНН+КПП из подсказки).

## B. Антидубли — только staff (ФТ-13.4)

- [ ] B1. Сервис `src/lib/services/duplicates/findByInn.ts`:
  `findByInn(prisma, session, { inn })` — только manager/admin (клиентским
  ролям `forbidden`); нормализация ИНН; выдача `{ organizations: [{id, name}],
  leads: [{id, subject, status}] }` (активные лиды: не rejected/promoted);
  без ПДн физлиц в выдаче — названия организаций и темы лидов.
- [ ] B2. `GET /api/duplicates/by-inn?inn=` — тонкий staff-роут
  (canTriageClientRequests-гейт; rate-limit 30/мин).
- [ ] B3. Плашка `inn-duplicate-hint.tsx` (клиентский, staff-формы): при вводе
  10/12-значного ИНН зовёт B2 → «Уже есть в базе: [название]» со ссылкой на
  карточку организации (/manager/organizations/... или /admin/organizations/...)
  и списком активных лидов; НЕ блокирует сабмит.
- [ ] B4. Встраивание плашки: триаж-очередь заявок (раскрытие заявки с ИНН —
  подсказка перед «Принять → создать лид»), `lead-create-staff-form`,
  `create-organization-dialog` (существующая блокирующая ошибка `inn_exists`
  остаётся последним рубежом на unique-констрейнте, но плашка предупреждает
  до сабмита). Клиентские формы (client-request-form) плашку НЕ зовут —
  guard-тест «нет вызова /api/duplicates из клиентских форм».

## C. Тесты (порог 100%) и ворота

- [ ] C1. PartyAutocomplete: debounce/фетч/выбор/деградация/клавиатура (jsdom).
- [ ] C2. findByInn: staff-only, нормализация, выдача org+leads; роут: гейты,
  rate-limit; guard-тест «клиентские роли → forbidden».
- [ ] C3. Плашка: показ/ссылки/не блокирует; встраивания; guard-тест B4.
- [ ] C4. `typecheck`/`lint`/`test:unit` зелёные; integration по затронутым
  местам; CHANGELOG; STATUS; PR. После мержа — этап 5 = ✅ готов.
