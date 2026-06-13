# Frontend Tier 3 — data-fetching (client reads) — Design / Spec

> **Контекст.** Финальный слой фронт-трека. Tier 1 ([2026-06-10](2026-06-10-frontend-foundation-design.md), PR #110) — `ui/`-примитивы/toast/errorMessageRu. Tier 2 ([2026-06-11](2026-06-11-frontend-tier2-dedup-design.md), PR #111+) — table-примитивы + дедуп инбоксов. useActionState Фазы 1–4 ([forms-design](2026-06-11-useactionstate-forms-design.md), PR #117/#120) — submit-слой. Остаётся Tier 3: **клиентская загрузка данных (reads)**.

## Reality-check (что показала разведка кода)

Исходная формулировка Tier 3 — «миграция на SWR/React-Query + оптимистичные апдейты + кэш поллинга» — **не сходится с кодом**. Приложение почти целиком на server-components + server-actions. Клиентская загрузка данных (reads) живёт буквально в 4 местах; большинство `fetch(` в клиентских компонентах — это **мутации**, уже закрытые Tier 2 (`useFormAction`/`useFetchSubmit`) или одноразовые экшены (download/delete).

**Реальные client-read поверхности:**

| Компонент | Что делает | Сейчас |
|---|---|---|
| `unread-badge.tsx` | поллит `/api/messages/unread` (4 страницы сообщений) | свой `setInterval` 15s + `useState`, **без** visibility-gate |
| `order-thread-inbox.tsx` | начальная загрузка треда + дельты | `fetch` + `useThreadPolling` (**уже чистый**) |
| `documents-panel.tsx` | список `/api/documents` (admin-only, mount + после upload) | `fetch` + `useState`, ручной `loadDocs` |
| `commission-statements-list.tsx` | ленивая подгрузка позиций при раскрытии (кэш-однократно) | `fetch` + `useState` + guard `items === null` |

## Решение (брейнсторм 2026-06-13)

| Вопрос | Решение |
|---|---|
| Библиотека или хук | **Рукописный хук, без библиотеки.** SWR — оверинжиниринг ради 4 поверхностей и расхождение с hand-rolled философией проекта (Tier 1/2, `useThreadPolling`). |
| Оптимистичные апдейты | **Не делаем (YAGNI).** На клиенте нет кэшируемых списков, мутируемых клиентом — все мутации идут через server-actions + `router.refresh()`. Решение несуществующей проблемы. |
| `order-thread-inbox` | **Остаётся на `useThreadPolling`** — специализированный cursor-delta polling, не generic resource. |
| Объём | Хук + миграция `unread-badge` + `documents-panel`; `commission-statements-list` — если ляжет чисто, иначе обоснованный skip. |

**Принцип эффективности:** ценность / (внесённая сложность + риск). Хук-sibling переиспользует доказанный паттерн `useThreadPolling`, тестируется тем же classic-JSX подходом (см. [[project-vitest-classic-jsx]]), ноль рантайм-зависимостей, легко удалить/форкнуть.

---

## Компонент 1 — `useClientResource<T>`

`src/hooks/useClientResource.ts` (client hook, sibling к `useThreadPolling`).

```ts
type Options<T> = {
  enabled?: boolean;          // default true; false → не грузить (ленивый/гейтированный режим)
  intervalMs?: number;        // если задан — visibility-gated polling (как useThreadPolling)
  select?: (raw: unknown) => T; // опц. маппер JSON-ответа → T (напр. d => d.count)
};

function useClientResource<T>(
  url: string,
  options?: Options<T>
): {
  data: T | null;
  loading: boolean;     // true во время первой загрузки (не во время фонового поллинга)
  error: boolean;       // сетевая ошибка / !res.ok последней попытки
  refetch: () => void;  // ручное обновление (напр. после upload)
};
```

**Поведение:**
- На mount (если `enabled`) — одна загрузка; `loading=true` до первого ответа.
- `refetch()` — повторная загрузка без сброса `data` (фоновое обновление).
- `intervalMs` — фоновый поллинг: НЕ грузим при `document.visibilityState !== 'visible'`; немедленная загрузка при возврате видимости (переносим логику из `useThreadPolling` 1-в-1). Интервал НЕ пересоздаётся на каждый render — `url`/`select`/`enabled` в зависимостях/refs аккуратно (повторяем ref-паттерн `useThreadPolling`, чтобы стабильная функция `select`/меняющийся колбэк не рвали интервал).
- `enabled: false → true` — триггерит загрузку (покрывает lazy-on-expand: `enabled: open`).
- Отмена in-flight при unmount (cancelled-флаг или `AbortController`).
- Ошибки **проглатываются** в `error: true` (defensive, как `unread-badge`/`useThreadPolling`); не кидаем.

**Намеренно НЕ делаем:** глобальный кэш по ключу, дедуп между инстансами, stale-while-revalidate-конфиги, мутации. Это generic single-resource read-хук, не мини-SWR.

### Тесты (`src/__tests__/hooks.useClientResource.test.ts`)
- mount-fetch заполняет `data`, снимает `loading`.
- `select` применяется к ответу.
- `!res.ok` / throw → `error: true`, без краша.
- `enabled: false` → нет fetch; переход в `true` → fetch.
- `refetch()` повторно дёргает url.
- polling: visibility-gate (мок `document.visibilityState`), интервал не пересоздаётся при смене `select`.
- Паттерн моков как у [[hooks.useThreadPolling.test]]: фейковые таймеры + мок `fetch`.

---

## Компонент 2 — миграции

Каждая миграция — **независимый файл** (подходит для параллельного диспатча агентов; общая зависимость — хук — строится первой, в отдельной фазе).

### 2a. `unread-badge.tsx`
```ts
const { data: count } = useClientResource<number>('/api/messages/unread', {
  intervalMs: 15_000,
  select: (d) => (d as { count?: number }).count ?? 0,
});
if (!count || count <= 0) return null;
```
Выигрыш: −ручной `setInterval`/cancelled-флаг; **visibility-gating даром** (сейчас поллит и на скрытой вкладке). Разметка бейджа без изменений. Существующий smoke-тест `components.unread-badge.test.tsx` остаётся зелёным (мокает fetch/рендер, не таймер).

### 2b. `documents-panel.tsx`
```ts
const { data: docs, refetch } = useClientResource<DocumentItem[]>('/api/documents');
// после успешного upload: await ...; refetch();
```
Выигрыш: −`loadDocs`/`useEffect`/eslint-disable. Upload-форма и download — **не трогаем** (мутации/одноразовый экшен; вне scope Tier 3, отдельный legacy-долг по стилю). `docs ?? []` для рендера до загрузки.

### 2c. `commission-statements-list.tsx` (условно)
```ts
const { data: items, loading: loadingItems } = useClientResource<CommissionStatementItem[]>(
  `/api/partner/finance/statements/${stmt.id}`,
  { enabled: open, select: (d) => (d as ...).statement?.items ?? [] }
);
```
Кэш-однократно сейчас держится через `items === null` guard; хук с `enabled: open` грузит при первом раскрытии и хранит `data` (повторное раскрытие не перегружает, т.к. `data` сохраняется). PATCH-утверждение (`handleApprove`) — мутация, **не трогаем**. **Если** ленивый режим (`enabled`-переход) ляжет чисто и тест зелёный — мигрируем; иначе оставляем как есть с записью в close-out (обоснованный skip). Не ломаем форму ради унификации.

---

## Data flow / Error handling

Без изменений в API-контрактах, RBAC, server-actions. Хук — чистая клиентская обёртка над теми же GET-эндпоинтами. Error-поведение сохраняется (тихая деградация: бейдж не показывается, список пуст).

## Тест-стратегия (§6)

| Что | Как |
|---|---|
| `useClientResource` | Новый unit-файл (см. выше), classic-JSX. |
| Регресс миграций | Существующие unit-тесты (`components.unread-badge`) зелёные **без правок**; `npm run test:unit` целиком. |
| Визуальный регресс | Разметка переносится 1-в-1 → Playwright-снапшоты совпадают (прогон опционален, локально). |

Слои: L1 + L2 (unit). Integration/L2.5 не затрагиваются (нет правок prisma/worker/services).

## Верификация

`npm run typecheck` · `npm run lint` (0 warnings) · `npm run test:unit` · `npm run build`.

## Декомпозиция для исполнения (parallel dispatch)

- **Фаза 1 (последовательно, TDD):** `useClientResource` + unit-тест. Блокирует миграции.
- **Фаза 2 (параллельный диспатч, 2–3 независимых файла):** агент A → `unread-badge`; агент B → `documents-panel`; агент C → `commission-statements-list` (условно). Непересекающиеся файлы, общая зависимость уже готова → нет shared state.
- **Гейт оркестратором:** консолидированный typecheck/lint/test:unit/build (как в useActionState Фазах 2–4).

## Не входит (follow-up)

- `order-thread-inbox` / `useThreadPolling` — оставлены как есть.
- Библиотека data-fetching, оптимистичные апдейты, глобальный кэш — YAGNI.
- Legacy-стиль `documents-panel` (сырой инпут «ID заказа», инлайн-hex, не на `ui/`) — отдельный косметический долг, не часть Tier 3.
- **eslint-guardrail на инлайн-hex** — по-прежнему отложен до около-нулевого счётчика (Tier 1 §6).
