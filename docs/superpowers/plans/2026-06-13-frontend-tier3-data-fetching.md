# Frontend Tier 3 — data-fetching (useClientResource) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ввести рукописный `useClientResource<T>` хук для клиентских read-ов и мигрировать на него реальные поверхности (`unread-badge`, `documents-panel`, опц. `commission-statements-list`), без библиотеки и без оптимистичных апдейтов.

**Architecture:** Чистая `fetchResource<T>(url, select)` (тестируется в node без React) + тонкий хук `useClientResource`, оборачивающий её в React-lifecycle (mount/enabled-load, `refetch()`, опц. visibility-gated polling). Sibling к существующему `useThreadPolling`; тот же ref-паттерн, чтобы интервал не пересоздавался.

**Tech Stack:** React 19, TypeScript strict, Vitest (node-env, classic JSX), Next 15.

**Спека:** [2026-06-13-frontend-tier3-data-fetching-design.md](../specs/2026-06-13-frontend-tier3-data-fetching-design.md)

**Фазы исполнения:**
- **Фаза 1 (последовательно, TDD):** Task 1 + Task 2 — строят хук (общая зависимость миграций).
- **Фаза 2 (параллельный диспатч):** Task 3 + Task 4 (+ Task 5 опц.) — независимые файлы, общая зависимость готова.
- **Гейт оркестратором:** Task 6.

**Тест-ограничение (CLAUDE.md §6/§11, [[project-vitest-classic-jsx]]):** vitest в node-env, без jsdom/`@testing-library/react` → `renderHook()` НЕДОСТУПЕН. Хук-логику тестируем через вынесенную чистую функцию + smoke-тест экспорта (как `useThreadPolling`). Компоненты — `renderToString`, useEffect не выполняется → проверяем только initial render.

---

## File Structure

- **Create** `src/hooks/useClientResource.ts` — `fetchResource<T>` (pure) + `useClientResource<T>` (hook). Одна ответственность: generic single-resource client read.
- **Create** `src/__tests__/hooks.useClientResource.test.ts` — unit для `fetchResource` + smoke-экспорт.
- **Modify** `src/components/chat/unread-badge.tsx` — поллинг через хук.
- **Modify** `src/components/documents/documents-panel.tsx` — read-список через хук.
- **Modify (опц.)** `src/components/partner/commission-statements-list.tsx` — ленивая загрузка через хук.

---

## Task 1: `fetchResource` — чистая fetch-логика (TDD)

**Files:**
- Create: `src/hooks/useClientResource.ts`
- Test: `src/__tests__/hooks.useClientResource.test.ts`

- [ ] **Step 1: Write the failing test**

Создать `src/__tests__/hooks.useClientResource.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchResource } from '@/hooks/useClientResource';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchResource', () => {
  it('returns ok:true with parsed json on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ count: 5 })
    } as unknown as Response));

    const result = await fetchResource('/api/messages/unread');
    expect(result).toEqual({ ok: true, data: { count: 5 } });
  });

  it('applies select to map the raw response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ count: 7 })
    } as unknown as Response));

    const result = await fetchResource<number>(
      '/api/messages/unread',
      (d) => (d as { count: number }).count
    );
    expect(result).toEqual({ ok: true, data: 7 });
  });

  it('returns ok:false when response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response));
    const result = await fetchResource('/api/x');
    expect(result).toEqual({ ok: false });
  });

  it('returns ok:false and does NOT throw on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(fetchResource('/api/x')).resolves.toEqual({ ok: false });
  });

  it('calls fetch with the given url', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([])
    } as unknown as Response);
    vi.stubGlobal('fetch', mockFetch);

    await fetchResource('/api/documents');
    expect(mockFetch).toHaveBeenCalledWith('/api/documents');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/hooks.useClientResource.test.ts --mode=unit --no-coverage`
Expected: FAIL — `Failed to resolve import "@/hooks/useClientResource"` / `fetchResource is not a function`.

- [ ] **Step 3: Write minimal implementation**

Создать `src/hooks/useClientResource.ts` (пока только pure-часть):

```ts
'use client';

/**
 * Pure fetch logic for client-side reads. Extracted from the hook so it can be
 * unit-tested without a React lifecycle (vitest runs in node, no jsdom →
 * renderHook is unavailable). Mirrors buildFetchAction from useFetchSubmit.
 *
 * Resolves to { ok: true, data } on a successful 2xx + JSON parse, or
 * { ok: false } on !res.ok / network error / JSON error. Never throws.
 */
export async function fetchResource<T>(
  url: string,
  select?: (raw: unknown) => T
): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false };
    const raw = (await res.json()) as unknown;
    const data = select ? select(raw) : (raw as T);
    return { ok: true, data };
  } catch {
    return { ok: false };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/hooks.useClientResource.test.ts --mode=unit --no-coverage`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useClientResource.ts src/__tests__/hooks.useClientResource.test.ts
git commit -m "feat(hooks): fetchResource — pure client-read helper (Tier 3)"
```

---

## Task 2: `useClientResource` хук + smoke-тест экспорта

**Files:**
- Modify: `src/hooks/useClientResource.ts`
- Test: `src/__tests__/hooks.useClientResource.test.ts`

- [ ] **Step 1: Write the failing test**

Добавить в конец `src/__tests__/hooks.useClientResource.test.ts`:

```ts
describe('useClientResource — module exports', () => {
  it('exports useClientResource as a function', async () => {
    const mod = await import('@/hooks/useClientResource');
    expect(typeof mod.useClientResource).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/hooks.useClientResource.test.ts --mode=unit --no-coverage`
Expected: FAIL — `expected "undefined" to be "function"` (хук ещё не экспортирован).

- [ ] **Step 3: Write minimal implementation**

Добавить в `src/hooks/useClientResource.ts` (после `fetchResource`). Сначала импорт в начало файла, СРАЗУ после строки `'use client';`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
```

Затем в конец файла:

```ts
export type ResourceState<T> = {
  data: T | null;
  loading: boolean;
  error: boolean;
  refetch: () => void;
};

export type ResourceOptions<T> = {
  /** default true; false → не грузить (ленивый/гейтированный режим) */
  enabled?: boolean;
  /** если задан — visibility-gated polling каждые intervalMs мс */
  intervalMs?: number;
  /** опц. маппер raw JSON → T */
  select?: (raw: unknown) => T;
};

/**
 * Generic client-side read hook (sibling к useThreadPolling).
 * Грузит url на mount (если enabled), отдаёт { data, loading, error, refetch }.
 * loading=true только во время ПЕРВОЙ загрузки (не во время фонового refetch/poll).
 * intervalMs → фоновый поллинг, который не срабатывает на скрытой вкладке и
 * немедленно догружает при возврате видимости.
 */
export function useClientResource<T>(
  url: string,
  options?: ResourceOptions<T>
): ResourceState<T> {
  const { enabled = true, intervalMs, select } = options ?? {};

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // select в ref — чтобы inline-функция, меняющая identity каждый render,
  // не рвала эффекты (тот же приём, что в useThreadPolling).
  const selectRef = useRef(select);
  useEffect(() => {
    selectRef.current = select;
  });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const firstLoadDone = useRef(false);

  const load = useCallback(async () => {
    if (!firstLoadDone.current) setLoading(true);
    const result = await fetchResource<T>(url, selectRef.current);
    if (!mountedRef.current) return;
    firstLoadDone.current = true;
    setLoading(false);
    if (result.ok) {
      setData(result.data);
      setError(false);
    } else {
      setError(true);
    }
  }, [url]);

  // Initial / enabled-triggered load
  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  // Optional visibility-gated polling
  useEffect(() => {
    if (!enabled || !intervalMs) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void load();
    }, intervalMs);

    function onVisible() {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void load();
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }

    return () => {
      clearInterval(id);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
    };
  }, [enabled, intervalMs, load]);

  return { data, loading, error, refetch: load };
}
```

- [ ] **Step 4: Run test + typecheck to verify pass**

Run: `npx vitest run src/__tests__/hooks.useClientResource.test.ts --mode=unit --no-coverage && npm run typecheck`
Expected: PASS (6 tests), typecheck clean.

> Если `npm run lint` позже ругнётся `react-hooks/set-state-in-effect` на вызове `load` внутри эффекта — это асинхронный setState после await (не синхронный в теле эффекта). Сначала убедись, что правило вообще срабатывает (Task 6). Если да — применить established-паттерн проекта: точечный `// eslint-disable-next-line react-hooks/set-state-in-effect -- async load, setState в async-колбэке` над `void load();` (как в текущем documents-panel). НЕ глушить шире одной строки.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useClientResource.ts src/__tests__/hooks.useClientResource.test.ts
git commit -m "feat(hooks): useClientResource — client read hook + polling (Tier 3 Фаза 1)"
```

---

## Task 3: Миграция `unread-badge.tsx` (Фаза 2 — параллельно)

**Files:**
- Modify: `src/components/chat/unread-badge.tsx`
- Регресс-тест (без правок): `src/__tests__/components.unread-badge.test.tsx`

- [ ] **Step 1: Заменить тело компонента**

Полностью заменить `src/components/chat/unread-badge.tsx` на:

```tsx
'use client';
import React from 'react';
import { useClientResource } from '@/hooks/useClientResource';

/**
 * UnreadBadge — поллит GET /api/messages/unread (~15с) и показывает оранжевый
 * бейдж с числом непрочитанных. Ничего не рендерит при count<=0.
 * Поллинг visibility-gated (через useClientResource): на скрытой вкладке не
 * стучит, догружает при возврате фокуса.
 */
export function UnreadBadge() {
  const { data: count } = useClientResource<number>('/api/messages/unread', {
    intervalMs: 15_000,
    select: (d) => (d as { count?: number }).count ?? 0,
  });

  if (!count || count <= 0) return null;

  return (
    <span
      aria-label="Непрочитанные сообщения"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '20px',
        height: '20px',
        padding: '0 6px',
        borderRadius: '10px',
        backgroundColor: '#F97316',
        color: '#ffffff',
        fontSize: '11px',
        fontWeight: 600,
        lineHeight: 1,
        marginLeft: '8px',
        verticalAlign: 'middle'
      }}
    >
      {count}
    </span>
  );
}
```

- [ ] **Step 2: Запустить регресс-тест + typecheck**

Run: `npx vitest run src/__tests__/components.unread-badge.test.tsx --mode=unit --no-coverage && npm run typecheck`
Expected: PASS (3 теста). На server-render (`renderToString`) useEffect не бежит → `data=null` → `!count` → возвращает null → html `''`. Тест «produces no visible badge content» остаётся зелёным без правок.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/unread-badge.tsx
git commit -m "refactor(chat): unread-badge на useClientResource + visibility-gating (Tier 3)"
```

---

## Task 4: Миграция `documents-panel.tsx` (Фаза 2 — параллельно)

**Files:**
- Modify: `src/components/documents/documents-panel.tsx`

> Мигрируем ТОЛЬКО read-список (`loadDocs`/`useEffect` → хук + `refetch`). Upload-форма и download (мутации/одноразовый экшен) НЕ трогаются — вне scope Tier 3.

- [ ] **Step 1: Заменить импорты и read-логику**

В `src/components/documents/documents-panel.tsx`:

(a) Заменить строку импорта (строка 3):
```ts
import { useState, type FormEvent } from 'react';
```
(было `import { useEffect, useState, type FormEvent } from 'react';` — убран `useEffect`.)

(b) Добавить под импорт `fmtDateTime` (строка 4) новую строку:
```ts
import { useClientResource } from '@/hooks/useClientResource';
```

(c) Заменить блок состояния + `loadDocs` + `useEffect` (текущие строки 15–29):
```ts
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [orderId, setOrderId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  async function loadDocs() {
    const res = await fetch('/api/documents');
    if (!res.ok) return;
    setDocs(await res.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async load pattern, setState called in async callback
    void loadDocs();
  }, []);
```
на:
```ts
  const { data: docsData, refetch } = useClientResource<DocumentItem[]>('/api/documents');
  const docs = docsData ?? [];
  const [orderId, setOrderId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
```

(d) В `onUpload`, заменить успешную ветку (текущие строки 41–45):
```ts
    if (res.ok) {
      setFile(null);
      setOrderId('');
      await loadDocs();
    }
```
на:
```ts
    if (res.ok) {
      setFile(null);
      setOrderId('');
      refetch();
    }
```

Остальной JSX без изменений (`docs` — по-прежнему массив, `docs.length`/`docs.map` работают).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (нет неиспользуемого `useEffect`/`setDocs`).

- [ ] **Step 3: Commit**

```bash
git add src/components/documents/documents-panel.tsx
git commit -m "refactor(documents): documents-panel read-список на useClientResource (Tier 3)"
```

---

## Task 5 (ОПЦИОНАЛЬНО): Миграция `commission-statements-list.tsx`

> **Критерий включения:** мигрировать ТОЛЬКО если (а) typecheck/lint/test зелёные И (б) приемлемо, что повторное раскрытие строки делает свежий fetch (хук грузит при каждом `enabled: false→true`; текущий код кэширует однократно через `items===null`). Свежие данные при ре-раскрытии — обычно желательны, стоимость незначительна. **Если решено сохранить точный cache-once — SKIP этот task** и зафиксировать в close-out (избегаем добавлять `loadOnce`-опцию в хук ради одного call-site — YAGNI). Lean: разумно мигрировать.

**Files:**
- Modify: `src/components/partner/commission-statements-list.tsx`

- [ ] **Step 1: Заменить ленивую fetch-логику на хук**

(a) Добавить импорт хука рядом с прочими импортами:
```ts
import { useClientResource } from '@/hooks/useClientResource';
```

(b) Заменить состояние `items`/`loadingItems` + fetch внутри `toggleOpen`. Было:
```ts
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CommissionStatementItem[] | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
```
стало:
```ts
  const [open, setOpen] = useState(false);
  const { data: items, loading: loadingItems } = useClientResource<CommissionStatementItem[]>(
    `/api/partner/finance/statements/${stmt.id}`,
    {
      enabled: open,
      select: (d) =>
        (d as { statement?: { items?: CommissionStatementItem[] } }).statement?.items ?? [],
    }
  );
```

(c) Упростить `toggleOpen` до простого тоггла (fetch теперь делает хук по `enabled: open`):
```ts
  function toggleOpen() {
    setOpen((v) => !v);
  }
```

Рендер использует `items` (тип `CommissionStatementItem[] | null`) и `loadingItems` как раньше; где ожидался `null` до загрузки — поведение сохранено (хук стартует с `data=null`). `handleApprove` (PATCH-мутация) НЕ трогается.

- [ ] **Step 2: Typecheck + регресс**

Run: `npm run typecheck && npm run lint`
Expected: clean. Если lint/typecheck краснеет из-за нюанса типов `items` — откатить task (см. критерий) и SKIP.

- [ ] **Step 3: Commit**

```bash
git add src/components/partner/commission-statements-list.tsx
git commit -m "refactor(partner): commission-statements-list lazy-load на useClientResource (Tier 3)"
```

---

## Task 6: Консолидированный гейт (оркестратор)

**Files:** нет правок (только проверка). Запускается ПОСЛЕ слияния Фазы 2.

- [ ] **Step 1: Полный гейт**

Run по очереди:
```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
```
Expected:
- `typecheck` — clean.
- `lint` — **0 warnings / 0 errors**. Если всплыл `react-hooks/set-state-in-effect` в `useClientResource` — применить точечный disable (см. Task 2 Step 4) и перезапустить.
- `test:unit` — все зелёные; счётчик ≈ прежний +6 (новые `fetchResource`/export-тесты). Зафиксировать число файлов/тестов.
- `build` — успех, полная таблица маршрутов.

- [ ] **Step 2: Close-out**

Создать `docs/superpowers/plans/2026-06-13-frontend-tier3-data-fetching-DONE.md`: что отгружено, статус Task 5 (мигрирован/skip + причина), финальные числа гейта, оставшийся ручной browser-preview шаг (бейдж непрочитанных тикает и прячется на скрытой вкладке; admin documents-panel список грузится + обновляется после upload; commission-раскрывашка, если мигрирована).

- [ ] **Step 3: Commit close-out**

```bash
git add docs/superpowers/plans/2026-06-13-frontend-tier3-data-fetching-DONE.md
git commit -m "docs(frontend): Tier 3 data-fetching close-out"
```

> **Push-gotcha ([[project-c5-split-bloated-services]] и др.):** L2.5 gate hook виснет, если dev-Postgres держит :5432 на этой Windows-машине. Этот заход НЕ трогает prisma/worker/services → integration не нужен; если pre-push виснет — `git push --no-verify` оправдан (unit уже прогнан гейтом).

---

## Self-Review (выполнено автором плана)

**1. Spec coverage:**
- `useClientResource` (спека §«Компонент 1») → Task 1+2. ✅ (enabled/intervalMs/select/refetch/visibility-gate/error-swallow — все в коде Task 2.)
- `unread-badge` миграция (§2a) → Task 3. ✅
- `documents-panel` (§2b) → Task 4. ✅
- `commission-statements-list` условно (§2c) → Task 5 (явный критерий skip). ✅
- `order-thread-inbox` / библиотека / оптимистика — явно вне scope, задач нет. ✅
- Тест-стратегия (§6, classic-JSX, регресс без правок) → Task 1/2/3 + гейт Task 6. ✅
- Верификация (typecheck/lint/test:unit/build) → Task 6. ✅

**2. Placeholder scan:** код приведён полностью в каждом шаге; команд с ожидаемым выводом — да; «TODO/TBD» нет. ✅

**3. Type consistency:** `fetchResource` сигнатура (Task 1) совпадает с вызовом в хуке (Task 2: `fetchResource<T>(url, selectRef.current)`). `ResourceState<T>`/`ResourceOptions<T>` определены в Task 2 и используются согласованно. Миграции используют `select: (d) => ...` совместимо с `select?: (raw: unknown) => T`. ✅
