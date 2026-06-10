# Frontend Foundation Layer (Tier 1) — Design / Spec

> **Контекст.** Бэкенд проекта дисциплинирован контрактами (§3 Result, §4 RBAC defense-in-depth, §6 4-слойные тесты, mode-aware scope). Фронтенд такой же дисциплины не получил: ~62 клиентских компонента держатся на ручном повторении паттернов, а не на общих абстракциях. `src/components/ui/` содержит **единственный** примитив (`dialog.tsx`). Этот spec заводит недостающий тонкий фундамент.

**Цель.** Завести переиспользуемый презентационный фундамент фронтенда: `ui/`-примитивы, единый словарь `errorCode→RU`, настоящий toast-фидбек, исправленную документацию и a11y «из коробки». Доказать на 1-2 эталонных формах + warn-guardrail на остаточный долг.

**Почему сейчас.** Code-backlog C-track исчерпан (см. MEMORY); фронт — единственный слой без своего контракта. Каждая форма переизобретает loading/error/success-стейт, словарь ошибок и стилизацию кнопки заново: `bg-[#F97316]` инлайнится ~69 раз, `text-[#111111]` ~40 раз, словарь `ERROR_LABEL_RU` копируется по формам с расхождениями. `<Toaster>` смонтирован в layout, но `toast()` не вызван **ни в одном** компоненте — мёртвый код.

**Принципиально.** Это презентационный/контрактный слой. **Ноль** изменений в RBAC, services, Result-контракте, роутинге, путях сабмита (`fetch` vs server-action остаются как есть). Консолидируем только *презентацию* и *маппинг строк ошибок*.

---

## Решения (из брейнсторма 2026-06-10)

| Вопрос | Решение |
|---|---|
| Объём захода | **Только Tier 1** (фундамент). Tier 2 (дедуп) и Tier 3 (data-fetching) — отдельные follow-up spec'и по §8. |
| Стратегия миграции | **Создать примитивы + словарь + toast, мигрировать 1-2 эталонные формы.** Остальные ~69 мест — инкрементально позже. |
| Источник примитивов | **Руками, на Tailwind, без новых зависимостей** (как уже сделан `dialog.tsx`). Ноль Radix/shadcn. |
| Guardrail | **eslint-правило на уровне `warn` сейчас.** Поднять до `error` — follow-up после завершения миграции. |

---

## Архитектура

### 1. Примитивы `src/components/ui/` (руками, Tailwind)

Каждый — строго презентационный + domain-agnostic тип → ровно carve-out §4 («не делай общее по ролям, **кроме** строго презентационного domain-agnostic»). Доменная логика (что слать, куда, какой scope) остаётся в `partner-*/manager-*/organization-*`.

| Файл | Контракт |
|---|---|
| `button.tsx` | `variant: 'primary' \| 'secondary' \| 'ghost' \| 'danger'`, `size?`, `loading?` (показывает `<Spinner>` + `disabled`), нативные `<button>`-пропсы. Запекает палитру `#F97316`/`#EA580C` (§13), focus-ring, disabled-opacity. Убивает ~69 инлайн-кнопок. |
| `input.tsx`, `textarea.tsx`, `select.tsx` | Единый border/focus, `aria-invalid` при ошибке, связка с `<label>` через `id`/`htmlFor`. Нативные пропсы проброшены. |
| `badge.tsx` | `tone: 'neutral' \| 'info' \| 'success' \| 'warning' \| 'danger'`. Заменяет инлайн role/status-бейджи (`inline-flex … bg-[#FFF7ED] text-[#9A3412] …`). |
| `spinner.tsx` | `lucide-react` `Loader2` + `animate-spin`, размер-проп. Используется в `Button.loading` и inline-состояниях списков ("Готовим…" → спиннер). |
| `field.tsx` | Обёртка `label + control + error-region`. Проводит `aria-describedby` → error, `role="alert"` на error-регионе. |

**Барель-экспорт `src/components/ui/index.ts`** — публичные примитивы. (`pickInitialFocus` и внутренние helpers `dialog.tsx` остаются приватными, как в C5-паттерне «export * только публичное».)

**Classic-JSX gotcha:** vitest.config без react-плагина → unit-тестируемые компоненты обязаны `import React` (иначе `renderToString` падает «React is not defined»; typecheck/next build проходят без этого — ловится только тестом). Каждый примитив с unit-тестом импортирует React явно.

### 2. Словарь ошибок — `src/lib/errors/messages.ts`

Чистые данные + функция, без React (`components→lib` разрешено §2).

```ts
// Плоская карта: коды §3 уже глобально-стабильные строки → плоская структура матчит контракт.
const RU: Record<string, string> = {
  forbidden: 'Доступ запрещён',
  not_found: 'Не найдено',
  too_large: 'Файл слишком большой (макс. 20 МБ)',
  invalid_mime: 'Недопустимый тип файла',
  storage: 'Ошибка хранилища, попробуйте позже',
  network: 'Ошибка сети, попробуйте ещё раз',
  no_file: 'Файл не выбран',
  invalid_recipient: 'Недопустимый получатель',
  // + богатые leadAttachments/scan-коды по факту существующих ERROR_LABEL_RU
};

export function errorMessageRu(code: string, fallback = 'Произошла ошибка'): string {
  return RU[code] ?? fallback;
}
```

Заменяет per-form копии `ERROR_LABEL_RU`. Безопасный fallback — сырой токен юзеру не утечёт. **Перед реализацией:** собрать union всех существующих кодов из текущих `ERROR_LABEL_RU`-словарей (partner/org/manager upload, leadAttachments, scan), чтобы карта была полной.

### 3. Toast — `src/lib/ui/toast.ts` (тонкий ре-экспорт Sonner)

`<Toaster richColors position='top-right'>` уже в `src/app/layout.tsx`. Тонкий ре-экспорт с проектными конвенциями. **Политика фидбека:**

- **Toast** — транзиентные исходы: success после закрытия формы («Документ загружен»), неожиданные/network-ошибки.
- **Inline `role="alert"`** (через `field.tsx`) — field-level валидация, что должна оставаться у контрола.
- **`Dialog.error/notice`** (aria-live слоты, уже есть) — фидбек *внутри* модалки; toast — для success после её закрытия.

### 4. Документация

- **CLAUDE.md §9** — переписать с несуществующего `useDialogFocus(open)` на фактический `Dialog`-компонент. §9 сейчас ловушка: агент по инструкции пойдёт искать/звать хук, которого нет (миграция на нативный `<dialog>` в PR #79/#80 перенесла фокус-менеджмент в `ui/dialog.tsx` через `pickInitialFocus`). Новый текст: props `Dialog`, порядок `pickInitialFocus` (form control → submit → first focusable → panel), нативная `<dialog>`-семантика (`showModal`, inert-фон, implicit `role`/`aria-modal`), aria-live слоты `error`/`notice`.
- **CLAUDE.md §13** — добавить пункт: палитра — через примитивы/токены, не инлайн-hex (ссылка на guardrail).
- **Память** — обновить заметку про §9-staleness.

### 5. Accessibility

- **Запечь в примитивы:** `Button` focus-ring; `Input/Select/Textarea` `aria-invalid`; `field.tsx` `role="alert"` + `aria-describedby`.
- **На эталонных формах:** `role="alert"` на error-регионах (сейчас часть форм без него — напр. `lead-create-form.tsx`, `lead-attachment-dropzone.tsx`).
- **Дешёвый глобальный свип:** `scope="col"` на все `<th>` (сейчас нет нигде, риск нулевой, механическая правка).
- **Вне Tier 1:** глубокая a11y (keyboard-nav в таблицах, focus-management в редактируемых строках).

### 6. Guardrail (warn)

eslint-правило (`no-restricted-syntax` или custom), бан инлайн-литерала `#F97316`/`#EA580C` в `className` → нудж к `Button`/токенам. Начинаем **точечно с hex-литерала** (точно, мало шума), **не** с «бан сырого `<button>`» (слишком широко при незавершённой миграции). Уровень `warn` — не ломает сборку/хуки. **Probe-verified non-vacuous** (как C3 §2 / C5): тест, что правило реально срабатывает на инлайн-hex. Поднять до `error` — follow-up после миграции всех мест.

---

## Эталоны для миграции (1-2)

**Upload-трио** — лучшее доказательство: partner/org/manager-формы делят `DOC_TYPE_OPTIONS` + `ERROR_LABEL_RU` + стили кнопки.

Мигрируем **`partner-document-upload-form.tsx`** + **`manager-doc-upload-form.tsx`**:
- Покрывают *оба* пути сабмита: partner = server-action, manager = fetch-to-API (`/api/manager/documents/[id]/upload`).
- Покрывают *оба* словаря ошибок (manager богаче: +`no_file`, `network`, `invalid_recipient`).
- Доказывают примитивы (`Button.loading`, `Select`, `Field`) + `errorMessageRu` + toast на success одним заходом.

`organization-document-upload-form.tsx` мигрируется тем же паттерном позже (инкрементально).

---

## Data flow

Без изменений. Презентационный слой. Submit-пути остаются как есть (`fetch` vs server-action). Меняется только презентация контролов и маппинг кодов→строк.

## Error handling

Словарь `errorMessageRu(code)` — точка консолидации. Безопасный fallback гарантирует: неизвестный код → «Произошла ошибка», не сырой токен. Toast vs inline — по политике §3 выше.

---

## Тест-стратегия (§6)

| Что | Как |
|---|---|
| Примитивы рендерятся | Unit (vitest), `import React` явно. `Button.loading` → `disabled` + спиннер виден. `Badge` tone → классы. `Field` ошибка → `role="alert"` + `aria-describedby`. |
| Словарь | Unit: `errorMessageRu` маппит каждый известный код; неизвестный → fallback. |
| Регресс-гард миграции | Существующие тесты эталонных форм (`api.manager.documents.upload`, partner upload) остаются **зелёными** — поведение не меняется. Это и доказывает безопасность миграции. |
| Guardrail non-vacuous | Проба: eslint-правило срабатывает на инлайн-hex (как C3/C5). |
| a11y | Существующий dialog focus-trap e2e не трогаем. Опц.: assert `scope="col"` присутствует. |

Слои §6: L1 (pre-commit typecheck + test:changed), L2 (test:unit) — основной гард для этого чисто-фронтового захода. Integration/L2.5 не затрагиваются (нет правок prisma/worker/services).

---

## Не входит (follow-up spec'и по §8)

- **Tier 2:** слияние `messages-inbox` (partner vs org ~99% дубль), извлечение table-shell, `useActionState`-унификация сабмита форм.
- **Tier 3:** data-fetching архитектура (24 `router.refresh()` + 0 SWR/React-Query), оптимистичные апдейты, кэш-слой для поллинга.
- **Полная миграция** всех ~69 инлайн-сайтов на примитивы.
- **`'use client'`-границы** (сайдбары) — отдельная ревизия.
- Поднятие guardrail `warn → error`.
