# Frontend Tier 3 — data-fetching — DONE

> Companion close-out к спеке [2026-06-13-frontend-tier3-data-fetching-design.md](../specs/2026-06-13-frontend-tier3-data-fetching-design.md) и плану [2026-06-13-frontend-tier3-data-fetching.md](2026-06-13-frontend-tier3-data-fetching.md). Закрывает **финальный пункт фронтенд-roadmap** (Tier 1→2→useActionState→Tier 3).

**Дата:** 2026-06-13 · **Ветка:** `claude/frontend-tier3-data-fetching` (от `main` после мержа PR #120) · **Метод:** Фаза 1 (хук) инлайн TDD оркестратором; Фаза 2 (миграции) — параллельный диспатч 3 агентов по непересекающимся файлам (skill `dispatching-parallel-agents`); консолидированный гейт оркестратором.

## Что отгружено

| Что | Файл | Коммит |
|---|---|---|
| **`fetchResource` + `useClientResource`** (хук + 6 unit) | `src/hooks/useClientResource.ts`, `src/__tests__/hooks.useClientResource.test.ts` | b776a27 |
| Миграция **unread-badge** (+visibility-gating даром) | `src/components/chat/unread-badge.tsx` | 88d8a79 |
| Миграция **documents-panel** (read-список + `refetch` после upload) | `src/components/documents/documents-panel.tsx` | 68d5908 |
| Миграция **commission-statements-list** (lazy-load `enabled: open`) | `src/components/partner/commission-statements-list.tsx` | c0001f8 |

**Task 5 (commission-list) — мигрирован, НЕ пропущен.** Критерий skip не сработал: eslint/typecheck чисто. Сознательное поведенческое изменение: повторное раскрытие строки теперь делает свежий fetch (раньше — кэш-однократно через `items === null` guard). Свежие данные при ре-раскрытии желательны, стоимость пренебрежима — принято.

## Дизайн-решения (из спеки, подтверждены реализацией)

- **Рукописный хук, без библиотеки** (SWR/React-Query) — оверинжиниринг ради 4 поверхностей; расходится с hand-rolled философией (Tier 1/2, `useThreadPolling`).
- **Без оптимистичных апдейтов** — на клиенте нет мутируемых клиентом кэшей (мутации = server-actions + `router.refresh()`). YAGNI.
- `fetchResource` вынесена чистой (sibling-приём к `buildFetchAction` из `useFetchSubmit`) → тестируется в node без jsdom/renderHook (vitest-ограничение, [[project-vitest-classic-jsx]]).
- **`set-state-in-effect` не сработал** на `void load()` в эффекте — setState живёт в async-колбэке после `await`, не синхронно в теле эффекта; точечный disable НЕ потребовался (в отличие от старого documents-panel, где он был и теперь удалён).

## Вне scope (как и планировалось)

- `order-thread-inbox` / `useThreadPolling` — оставлены (специализированный cursor-delta polling, не generic resource).
- Upload/download/PATCH-мутации в мигрированных компонентах — не тронуты (Tier 2 или одноразовые экшены).
- Legacy-стиль `documents-panel` (сырой инпут «ID заказа», инлайн-hex, не на `ui/`) — отдельный косметический долг.
- eslint-guardrail на инлайн-hex — по-прежнему отложен.

## Верификация (консолидированный гейт, прогнан целиком оркестратором)

- `npm run typecheck` — clean.
- `npm run lint` — **0 warnings / 0 errors**.
- `npm run test:unit` — **196 файлов / 1473 теста** зелёные (было 1467; +6 `fetchResource`/export).
- `npm run build` — успех, полная таблица маршрутов.

Существующий `components.unread-badge.test.tsx` остался зелёным **без правок** (3 теста; server-render → `data=null` → null-рендер).

## Оставшийся ручной шаг (operator / browser-preview)

useEffect/поллинг не выполняются в server-render-тестах → визуальная проверка за оператором:
- **unread-badge** — бейдж непрочитанных появляется/тикает; на скрытой вкладке не стучит, догружает при возврате фокуса (новый visibility-gate).
- **admin `/admin/documents`** — список грузится на mount и обновляется после upload (`refetch`).
- **partner commission-раскрывашка** — позиции грузятся при первом раскрытии; ре-раскрытие догружает свежие.

## Roadmap

**Фронтенд-roadmap полностью закрыт** (Tier 1 → Tier 2 → useActionState Фазы 1–4 → Tier 3). Остаток проекта — внешне заблокированный Track A (live 1С, A1-встреча) + before-prod ops (`column-map.ts` под реальный экспорт, INN dup-precheck).
