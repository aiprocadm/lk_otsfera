# Frontend Foundation Layer (Tier 1) — DONE

> Companion close-out to [2026-06-10-frontend-foundation.md](2026-06-10-frontend-foundation.md) (plan = «что планировали», этот файл = «что отгрузили»). Spec: [../specs/2026-06-10-frontend-foundation-design.md](../specs/2026-06-10-frontend-foundation-design.md).

**Дата:** 2026-06-10 · **Ветка:** `claude/frontend-foundation` · **Метод:** subagent-driven development (implementer + spec/quality review per логический юнит).

## Что отгружено

| Слой | Файлы | Коммиты |
|---|---|---|
| `cn()` class-merge | `src/lib/ui/cn.ts` | `1c1385f` |
| Словарь ошибок | `src/lib/errors/messages.ts` (`errorMessageRu`, плоская карта, fallback) | `c950033` |
| Toast-обёртка | `src/lib/ui/toast.ts` (ре-экспорт sonner) | `3359b91` |
| Примитивы `ui/` | `spinner` `2a3575b`, `button` `e1098fd`, `input/textarea/select` `05715e3`, `badge` `21e230e`, `field` `51000f1`, barrel `index.ts` `8039eb4` | 6 коммитов |
| Миграция эталона 1 | `partner-document-upload-form.tsx` → примитивы + словарь + toast | `554ce38` |
| Миграция эталона 2 | `manager-doc-upload-form.tsx` → то же (fetch-путь) | `3967427` |
| a11y свип | `scope='col'` на **139 `<th>` в 26 файлах** | `c863a52` |
| Docs | CLAUDE.md §9 переписан (реальный `Dialog`-контракт вместо несуществующего `useDialogFocus`) + §13 палитра-через-примитивы | `5c5baa2` |

## Верификация (финальный гейт, прогнан целиком)

- `npm run typecheck` — clean.
- `npm run lint` — **0 warnings / 0 errors**.
- `npm run test:unit` — **181 файл / 1359 тестов** зелёные (было 1334; +25 новых: cn 2, errorMessages 3, toast 1, spinner 2, button 4, form-controls 4, badge 2, field 3, partner-form 2, manager-form 2).
- `npm run build` — успех, полная таблица маршрутов, без ошибок.

Ревью: foundation (Tasks 1-9) — spec+quality (APPROVED, минорное отклонение `children?` оставлено сознательно); миграции (Tasks 10-11) — APPROVED (submit-пути byte-identical, recipient auto-switch сохранён, все коды ошибок покрыты, нет dead-state).

## Поведение, изменённое намеренно

- Success-фидбек upload-форм: inline `<p role=status>` → `toast.success(...)`. Операционные ошибки остаются inline `role="alert"` (политика spec §3: toast — транзиент/network/success, inline — field-level).
- Brand-hex `#F97316`/`#EA580C` теперь живёт в `Button` (и focus-ring/file-input) — единая точка вместо инлайна.

## Сознательные решения / отклонения от плана

- **`Badge.children` / `Field.children` сделаны optional** — артефакт classic-JSX vitest-теста (`React.createElement(C, null, child)`); ревью подтвердило keep (нулевая потеря функциональности).
- **`import React`** добавлен в обе мигрированные формы (план показывал только `import { useRef, useState }`, но код ссылается на `React.FormEvent` → classic-JSX требует явный импорт). План был неточен, реализация исправила.

## Отложено (follow-up spec'и / chip'ы)

1. **eslint-guardrail на инлайн-hex** — снят из Tier 1: `lint-staged` гоняет `eslint --max-warnings=0` → warn блокирует staged-commit, а инлайн-hex в **123 файлах** (265 вхождений). Allowlist неподъёмен. Добавлять после миграции, когда счётчик около нуля (см. spec §6).
2. **Миграция остальных ~121 файла** на примитивы (Tier 2 объём) — инкрементально.
3. **`Field` не авто-проводит `aria-describedby`** к контролу (caller-wires через `...rest`). В Tier 1 не проявляется (эталонные формы не используют `Field.error` — ошибки операционные, отдельным `role="alert"`). Мелкий primitive-completeness gap; авто-wiring (доп. проп `errId` или render-prop) — кандидат на доработку при первом реальном `Field.error`-потребителе.
4. **Partner upload-форма: `try/finally` без `catch`** молча проглатывает брошенное network-исключение server-action'а (`isPending` сбрасывается, но юзер не видит ошибку). Pre-existing, не регресс этой ветки; manager-форма обрабатывает через явный `catch`. Добавить `catch { setError(errorMessageRu('network')); }` при следующем касании партнёрской формы.
5. **Tier 2** (слияние messages-inbox ~99% дубль, table-shell, `useActionState`) и **Tier 3** (data-fetching/SWR, оптимистичные апдейты) — отдельные spec'и.
