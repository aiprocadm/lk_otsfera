# Close-out: загрузка документов партнёра и организации через API-роут

**Статус: отгружено целиком одним PR
[#378](https://github.com/aiprocadm/lk_otsfera/pull/378) (17.08.2026).**
План: [2026-08-17-doc-upload-api-route.md](2026-08-17-doc-upload-api-route.md),
спека: [спека](../specs/2026-08-17-doc-upload-api-route-design.md). Все 10
пунктов плана `[x]`.

## Что отгружено

- Роуты `POST /api/partner/documents/upload` и
  `POST /api/organization/documents/upload` (эталон — менеджерский роут;
  сервисный слой не менялся).
- Три формы на `useFetchSubmit` + пре-чеки «файл не выбран» / «файл больше
  предела» до отправки.
- Хинты всех пяти документных форм — из `DEFAULT_MAX_FILE_SIZE_MB`; страж
  `components.upload-size-hint.guardrail` (проверен мутацией).
- Server actions `uploadPartnerDocument`/`uploadOrganizationDocument` удалены
  с тестами.

## Проверено

`typecheck` ✅ · `lint` ✅ · полный `test:coverage` на живом Postgres:
**10 896 тестов, 100/100/100/100, exit 0** (CI выключен — канон
local-evidence).

## Находка мимо объёма (починена здесь же)

Покрытие ветки `APP_URL` в `services/partner/team.ts` держалось на порядке
тестовых файлов: worker-процесс vitest делит `process.env`, и ветку
«переменная задана» закрывал чей-то чужой недовосстановленный стаб. Смена
состава тестовых файлов сдвинула порядок — гейт мигнул красным (99.99 %
branches). Добавлен тест всех трёх путей (`задана`/`пробелы`/`не задана`)
прямо в `services.partner.team.test.ts` — покрытие детерминировано.

## Осталось заказчику

- На проде проверить `client_max_body_size 200m` в nginx (стенд уже ок).
- Разовая перегенерация e2e-эталонов (все 38 устарели ещё с этапов 4–9;
  смена «20 МБ» → «200 МБ» попадёт в неё же).
