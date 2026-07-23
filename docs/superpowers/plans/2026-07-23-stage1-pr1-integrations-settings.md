# План — Этап 1 / PR-1: настройка 1С + WhatsApp/Max baseUrl + DaData

Спека: [2026-07-23-stage1-integrations-admin-dadata-design.md](../specs/2026-07-23-stage1-integrations-admin-dadata-design.md) §2–4, §11 (PR-1).
Цель PR-1: все интеграции настраиваются из `/admin/integrations` без правки env;
DaData-прокси работает. Проверка/диагностика/флаги — PR-2.

REQUIRED SUB-SKILL: superpowers:subagent-driven-development (по желанию — задачи мелкие).

## A. 1С в реестр настроек (ФТ-14.1, 14.2)

- [x] A1. `SETTING_SPECS` (+ `integrationSettings.ts`): `onec.adapter`
  (`ONE_C_ADAPTER`), `onec.apiUrl` (`ONE_C_API_URL`), `onec.apiToken`
  (`ONE_C_API_TOKEN`, secret), `onec.healthPath` (`ONE_C_HEALTH_PATH`).
- [x] A2. `getOneCAdapter()` → читает `cachedIntegrationSetting('onec.*')` вместо
  сырого env; пересборка синглтона при смене `kind|url|token` (cachedForKey).
  `resetOneCAdapter()` сохраняется. Throw при rest без url/token — сохраняется.
- [x] A3. Воркер подхватывает без рестарта: `primeIntegrationSettingsCache(db)`
  в начале sync-процессоров (orders/payments/documents/organizations) и в
  push-lead-потоке — до вызова `getOneCAdapter()`.
- [x] A4. Server-action `saveOnecSettingsAction` (validate adapter ∈ {fake,rest};
  через `saveGroup`, затем `resetOneCAdapter()`).
- [x] A5. Страница: `VIEW_KEYS += onec.*`, форма «Обмен с 1С» (select adapter,
  text apiUrl, text healthPath, secret apiToken); статус-карточка 1С читает
  `cachedIntegrationSetting('onec.adapter')`.
- [x] A6. Тесты: `getOneCAdapter` (DB>env после prime, пересборка при смене,
  throw), action (маппинг+валидация+сброс), статус, обновить существующие
  oneCSync.index/factory-тесты под новый источник (env-fallback сохраняется).

## B. whatsapp.baseUrl + max.baseUrl (ФТ-14.1)

- [x] B1. `SETTING_SPECS`: `whatsapp.baseUrl` (`WHATSAPP_AGGREGATOR_BASE_URL`),
  `max.baseUrl` (`MAX_API_BASE_URL`) — не секрет.
- [x] B2. `whatsappAggregatorBaseUrl()` / `maxApiBaseUrl()` →
  `cachedIntegrationSetting(...)` c дефолтом (`https://api.wazzup24.com` /
  `https://botapi.max.ru`).
- [x] B3. Server-actions WhatsApp/Max: добавить entry baseUrl.
- [x] B4. Страница: поля baseUrl в формах; `VIEW_KEYS += whatsapp.baseUrl, max.baseUrl`.
- [x] B5. Тесты: baseUrl из БД после prime, дефолт без задания; формы/actions.

## C. DaData: настройки + прокси (ФТ-13.1, 13.2)

- [x] C1. `SETTING_SPECS`: `dadata.enabled` (`DADATA_ENABLED`), `dadata.apiKey`
  (`DADATA_API_KEY`, secret).
- [x] C2. Сервис `src/lib/services/dadata/suggestParty.ts`:
  `suggestParty(prisma, query)` → читает `dadata.enabled`/`dadata.apiKey`
  (`getSettingValue`); выключено/нет ключа/ошибка/таймаут → `[]`; иначе POST
  `suggestions.dadata.ru/.../suggest/party` c `Authorization: Token <key>` →
  нормализация (name, inn, kpp, ogrn, address). Ключ наружу не отдаётся.
- [x] C3. Роут `src/app/api/suggest/party/route.ts` (GET `?query=`):
  `requireSession` (401 без сессии); `isRateLimited('suggest:party:<sub>', …)`
  → 429; пустой/короткий query → `{ suggestions: [] }`; иначе сервис →
  `{ suggestions }`.
- [x] C4. Server-action `saveDadataSettingsAction` (enabled checkbox + apiKey secret).
- [x] C5. Страница: форма «DaData» (checkbox enabled, secret apiKey);
  `VIEW_KEYS += dadata.enabled, dadata.apiKey`; статус-карточка DaData.
- [x] C6. Проверить middleware/`protectedPrefixes`: роут само-гейтится
  `requireSession` — убедиться, что префикс не требует спец-обработки (или добавить).
- [x] C7. Тесты: роут (401/429/пусто/happy/ключ-не-утекает), сервис (ветки), action.

## D. Env-доки и CHANGELOG

- [x] D1. `.env.example`: `ONE_C_HEALTH_PATH`, `DADATA_ENABLED`, `DADATA_API_KEY`
  (whatsapp/max baseUrl уже есть — отметить, что теперь настраиваются в UI).
- [x] D2. `CHANGELOG.md`: запись про PR-1.

## E. Зелёные ворота

- [x] E1. `npm run typecheck` — зелёный
- [x] E2. `npm run lint` — без ошибок/варнингов
- [x] E3. `npm run test:unit` — 697 файлов / 6866 тестов зелёные (3 skip).
  Integration-слой (L3/gate, нужен Postgres) в этой сессии не гонялся.
- [ ] E4. Обновить STATUS.md (PR-1 открыт), close-out при мерже.

## Вне PR-1 (→ PR-2)

Универсальная «Проверить подключение» (D спеки), диагностика вебхуков (E),
матрица feature-флагов на `/admin/settings` (F).
