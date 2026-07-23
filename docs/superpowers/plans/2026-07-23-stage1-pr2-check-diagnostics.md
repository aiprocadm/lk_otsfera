# План — Этап 1 / PR-2: «Проверить подключение» + диагностика вебхуков + матрица флагов

Спека: [2026-07-23-stage1-integrations-admin-dadata-design.md](../specs/2026-07-23-stage1-integrations-admin-dadata-design.md) §5–7, §11 (PR-2).
Цель PR-2: все интеграции **проверяются** из `/admin/integrations` (универсальные
пробы по админ-конфигу), видна диагностика вебхуков, матрица feature-флагов на
`/admin/settings`. Закрывает вторую половину критерия приёмки этапа 1.

REQUIRED SUB-SKILL: superpowers:subagent-driven-development (по желанию — задачи мелкие).

## D. «Проверить подключение» (ФТ-14.3)

- [x] D1. Сервис `src/lib/services/admin/testIntegration.ts`:
  `testIntegration(prisma, key)` → `{ ok, message }` + upsert `SyncState`
  (entity `integration.<key>`: `lastRunAt`, `lastSuccessAt` при ok, `lastError`
  при сбое). Ключи: `email | telegram | max | whatsapp | imap | dadata | onec | mango`.
  Все пробы — по эффективным настройкам (`getSettingValue`, БД → env), таймаут
  ~5 с, fail-soft (сетевая ошибка → `{ ok: false }` с текстом, не throw).
- [x] D2. Пробы (по §5 спеки, всё по данным админа, ничего не зашито):
  - email — тестовое письмо на email текущего админа (`send()` из `@/lib/email/send`);
    `skipped` (выключено/нет ключа/нет email) → ok:false с причиной.
  - telegram — `GET api.telegram.org/bot<token>/getMe`.
  - max — `GET <maxBaseUrl>/me?access_token=<token>` (getMe-эквивалент).
  - whatsapp — `GET <baseUrl>/v3/channels` с Bearer apiKey; успех = 2xx
    (достаточно для «связь есть, ключ принят»).
  - imap — коннект + logout `ImapFlow` по host/port/user/password/tls
    (**новая зависимость `imapflow`**, dynamic import — тесты мокают модуль).
  - dadata — POST suggest/party c query `тест` по введённому ключу; успех = 2xx.
  - onec — `GET <apiUrl>/<healthPath?>` c `Authorization: Bearer <token>`
    (той же схемой, что `rest-wire.buildAuthHeader`); успех = 2xx.
  - mango — подписанный POST `<vpbxBaseUrl>config/users/request`
    (`vpbx_api_key`+`sign`+`json={}` — `computeMangoSign`); успех = 2xx,
    401/403 → «авторизация отклонена», прочее → «HTTP <код>».
- [x] D3. Server-action `testIntegrationAction(key)` в
  `src/server-actions/admin/integrationSettings.ts`: `requireAdmin` → сервис →
  `revalidatePath` → `{ ok, success, message }` (prime не нужен: пробы читают
  эффективные значения напрямую через `getSettingValue`).
- [x] D4. UI: кнопка «Проверить подключение» в карточках — кнопка с
  `formAction`-override внутри существующей формы (`IntegrationSettingsForm` +
  `EmailSettingsForm`), результат — inline `role="status"`/`role="alert"`;
  строка «Последняя проверка: <дата> — успешно/<ошибка>» из `SyncState`
  (props с сервера).
- [x] D5. Страница `/admin/integrations`: читает `SyncState` по entity
  `integration.*` и передаёт в карточки.

## E. Диагностика вебхуков (ФТ-14.4)

- [x] E1. Хелпер `recordWebhookEvent(prisma, name)` (в
  `src/lib/services/admin/webhookDiagnostics.ts`): upsert `SyncState`
  (entity `webhook.<name>`, `lastSuccessAt = now`), **never-throws**
  (`log.warn` при сбое) — вебхук обязан вернуть 200 быстро.
- [x] E2. Вызов в 4 вебхук-роутах (telegram/max/whatsapp/mango) после успешной
  аутентификации события; ошибка записи не меняет ответ.
- [x] E3. UI: на карточках TG/Max/WhatsApp/Mango — блок «Вебхук»: готовый URL
  `<APP_URL>/api/integrations/<name>/webhook`, имя секрет-заголовка,
  «секрет: задан/не задан» (сам секрет не показываем; для Mango — подпись
  по ключам, отдельного секрета нет → показываем IP-allowlist+подпись),
  «последнее входящее: <дата|—>» из `SyncState` `webhook.<name>`.

## F. Матрица feature-флагов на /admin/settings (ФТ-14.6)

- [x] F1. `featureFlags.ts`: экспорт `isOptInFlag(flag)` (или
  `flagDefault(flag): 'opt-in' | 'opt-out'`) — OPT_IN_FLAGS сейчас приватен.
- [x] F2. Компонент `src/components/admin/feature-flags-matrix.tsx`
  (серверный, read-only): таблица «флаг / описание (RU, из
  docs/feature-flags-matrix.md) / тип (включён по умолчанию | включается явно)
  / состояние (включён/выключен из `isFeatureEnabled`) / env-переменная».
  Рядом — список инфраструктурных env (`DATABASE_URL`, `JWT_SECRET`, S3-группа,
  `REDIS_URL`) «управляются в env сервера», **без значений**.
- [x] F3. Подключить на `/admin/settings`; обновить вводную плашку страницы —
  интеграции теперь настраиваются в `/admin/integrations` (текст устарел после PR-1).

## G. Тесты (§8 спеки)

- [x] G1. `testIntegration`: по каждому ключу — happy (мок fetch/транспорта →
  `SyncState.lastSuccessAt`), сбой (auth/network → `lastError`, ok:false),
  «не настроено». Секреты не попадают в message/SyncState.
- [x] G2. `testIntegrationAction`: requireAdmin, prime, маппинг результата.
- [x] G3. Вебхук-роуты: пишут `webhook.<name>.lastSuccessAt`; ошибка записи
  не роняет 200 (существующие тесты роутов остаются зелёными).
- [x] G4. Формы/страница: кнопка проверки, рендер «последняя проверка» и блока
  «Вебхук»; `/admin/settings` — матрица флагов рендерит состояние из
  `isFeatureEnabled`, инфраструктурный список без значений.
- [x] G5. `isOptInFlag` — unit.

## H. Env-доки, CHANGELOG, ворота

- [x] H1. `package.json`: + `imapflow` (для IMAP-пробы; poll-адаптер остаётся stub).
- [x] H2. `CHANGELOG.md`: запись про PR-2.
- [x] H3. `npm run typecheck` / `npm run lint` — зелёные.
- [x] H4. `npm run test:unit` — зелёный; integration по затронутым местам
  (живой Postgres) — зелёный.
- [x] H5. PR открыт ([#217](https://github.com/aiprocadm/lk_otsfera/pull/217)),
  STATUS.md обновлён (статус, ссылка, журнал).
