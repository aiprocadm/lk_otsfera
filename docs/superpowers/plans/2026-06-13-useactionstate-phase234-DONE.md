# useActionState Фазы 2–4 — DONE

> Companion close-out к спеке [2026-06-11-useactionstate-forms-design.md](../specs/2026-06-11-useactionstate-forms-design.md) (§4 Фазы 2–4). Продолжение [Фазы 1](2026-06-11-useactionstate-phase1-DONE.md). Закрывает остаток Tier-2-рефакторинга форм; roadmap-остаток после этого — только Tier 3 (SWR/data-fetching).

**Дата:** 2026-06-13 · **Ветка:** `claude/useactionstate-phase234` (от `main` после мержа PR #119) · **Метод:** параллельный диспатч 3 агентов по непересекающимся наборам файлов (skill `dispatching-parallel-agents`) + консолидированный гейт оркестратором.

## Что отгружено

| Фаза | Формы | Δ строк |
|---|---|---|
| **2 — Dialog-инвайты** (кластер 2) | `admin/assign-or-invite-manager-form`, `organization/invite-org-user-form`, `partner/invite-customer-admin-form` | −95 |
| **3 — uploads (server-action)** | `organization/organization-document-upload-form`, `organization/organization-order-less-upload-form`, `partner/partner-document-upload-form` | −38 |
| **4 — fetch-формы + хук** | новый `src/lib/ui/useFetchSubmit.ts` (+10 unit) + 7 миграций: partner `add-comment`/`invite-member`/`lead-create`/`lead-withdraw-button`/`manual-calc`, manager `doc-upload`/`order-less-upload` | +152 (вкл. хук+тест) |

Итого: мигрировано **13 форм** на `useFormAction`/`useFetchSubmit`; удалены локальные ERROR_LABELS/translateError-словари; **закрыт последний обход `NO_HANDROLLED_MODAL`** (`manual-calc-form`: сырая DIV-модалка → примитив `Dialog`).

## Граница фаз — оркестраторское решение (отклонение от спеки)

Спека группировала формы по «кластеру» (uploads vs fetch), но `documents-panel` и обе manager-upload-формы — это upload-формы на **fetch**-транспорте. Чтобы Фаза 3 не зависела от хука `useFetchSubmit` из Фазы 4 (иначе фазы перестают быть независимыми), граница проведена **по транспорту**:
- **Фаза 3** = только server-action upload-формы (org ×2, partner ×1) → существующий `useFormAction`.
- **Фаза 4** = всё на fetch (partner ×5 + manager-uploads ×2) → новый `useFetchSubmit`.

## `useFetchSubmit` — дизайн

Composed-over-`useFormAction` (спека §7.1, вариант «б»): тонкий адаптер строит `action: (fd)=>Promise<ActionResult<T>>` из fetch-дескриптора и делегирует generation/pending/reset/refresh в `useFormAction` (нулевое дублирование). Маппинг fetch→ActionResult вынесен в чистую `buildFetchAction<T>` (тестируется в node-окружении без jsdom). JSON-тело → `JSON.stringify` + content-type; `FormData` → как есть (multipart boundary браузером); `204` → успех; `{error}`-тело → код; иначе синтетический `http_<status>`; исключение → `network`.

## Сознательные нормализации / отклонения

1. **org upload-формы: inline-баннер успеха → `toast`.** До миграции partner-сиблинг уже был на toast, org — на inline `<p role=status>`. Конвертация выравнивает сиблинги И приводит к конвенции CLAUDE.md §9/§13 («транзиентный фидбек — через toast»). Inline-ошибка (`role=alert`) сохранена.
2. **3 формы НЕ мигрированы (обоснованный skip, кластер-5 спеки):** `member-row-actions` (2 сабмита: PUT+DELETE), `rate-override-form` (2 кнопки-действия set/clear на один endpoint), `documents-panel` (панель-оркестратор: list+upload+download, не single-submit — как `chat-composer`).
3. **email в success-UI Фазы 2:** server-action не возвращает email в payload → формы фиксируют его в локальном `useState`/ref из `formData.get('email')` до делегирования (server-actions не тронуты).
4. **`reset()` при open/close модалки** (Фаза 2) — очистка stale error/success при повторном открытии.
5. **auth-формы (`login`, `reset-password`) — вне scope** (спека §7.2): до-кабинетные, без Result-контракта, login security-чувствителен.

## Верификация (консолидированный гейт, прогнан целиком оркестратором)

- `npm run typecheck` — clean.
- `npm run lint` — **0 warnings / 0 errors** (убран один leftover-импорт `errorMessageRu` в partner-upload).
- `npm run test:unit` — **195 файлов / 1467 тестов** зелёные (было 1457; +10 `useFetchSubmit`).
- `npm run build` — успех, полная таблица маршрутов.

Существующие component-тесты (`organization-order-less-upload`, `partner-document-upload`, `manager-doc-upload`, `manager-order-less-upload`) остались зелёными **без правок** (мокают `next/navigation`/server-action, не `useTransition`).

## Оставшийся ручной шаг (operator / browser-preview)

Поведенческие риски `useActionState` (спека §6) покрыты unit-тестами, но визуальная проверка за оператором:
- **controlled-инпуты** `lead-create-form` — submit + редирект на `/partner/leads/<id>`.
- **`manual-calc-form`** новая Dialog-модалка — open/Escape/backdrop/submit.
- **org upload success→toast** — подтвердить, что тост устраивает (вместо прежнего inline-баннера).
- `add-comment-form` controlled textarea — очистка после отправки.

## Roadmap

Tier-2-рефакторинг форм **завершён** (Фазы 1–4). Остаток фронтенд-roadmap — **Tier 3** (data-fetching: SWR/React-Query, оптимистичные апдейты, кэш поллинга) + отложенный eslint-guardrail на инлайн-hex. Code-backlog по бэкенду исчерпан ранее; внешний блокер — live 1С (Track A).
