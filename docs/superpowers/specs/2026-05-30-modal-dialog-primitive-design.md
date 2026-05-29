# Общий `<Dialog>`-примитив + a11y-миграция модалок + guardrail — design

**Дата:** 2026-05-30
**Автор:** Claude (session-driven, brainstorming)
**Статус:** Approved (design step), pending implementation
**Related:** прямое продолжение [2026-05-27-modal-focus-trap-design.md](2026-05-27-modal-focus-trap-design.md) — реализует два явно отложенных там пункта: «Extracting a full `<DialogShell>` component» и «`inert`/`aria-hidden` on background».

## Проблема

В кабинетах накопилось **7 модальных окон**, и каждое заново реализует свою dialog-обвязку. Они разошлись на **двух несовместимых механизмах**:

| # | Файл | Механизм | a11y-дефекты |
|---|---|---|---|
| 1 | `src/components/organization/invite-org-user-form.tsx` | `<div>` + `useDialogFocus` | фон не `inert`; read-only invite-URL input без label |
| 2 | `src/components/partner/invite-customer-admin-form.tsx` | `<div>` + `useDialogFocus` | фон не `inert` |
| 3 | `src/components/admin/assign-or-invite-manager-form.tsx` | `<div>` + `useDialogFocus` | фон не `inert` |
| 4 | `src/components/admin/audit-diff-dialog.tsx` | `<div>` + `useDialogFocus` | фон не `inert` |
| 5 | `src/components/partner/invite-member-form.tsx` | native `<dialog>` + `showModal()` | нет `aria-labelledby`; feedback-`<div>` без `role` |
| 6 | `src/components/partner/lead-withdraw-button.tsx` | native `<dialog>` + `showModal()` | feedback-`<div>` без `role` |
| 7 | `src/components/partner/member-row-actions.tsx` | native `<dialog>` + `showModal()` | проверить при миграции |

Конкретные следствия:

1. **Фон не делается `inert`.** Кастомные `<div>`-модалки (включая «эталонную» org-форму) не отключают фоновую страницу. Скринридер и виртуальный курсор по-прежнему доходят до контента под оверлеем — нарушение WCAG 2.4.3 / 4.1.2. Это тот самый пункт, который [2026-05-27](2026-05-27-modal-focus-trap-design.md) отложил («requires a layout-level wrapper; deferred»).
2. **Live-region для feedback ненадёжны.** `role="alert"` уже несёт неявный `aria-live="assertive"`, `role="status"` — `aria-live="polite"`, так что org/admin-формы что-то да объявляют. Но: (а) у native-`<dialog>`-модалок (`invite-member`, `lead-withdraw`) feedback-`<div>` **без `role` вообще** — ошибки не объявляются; (б) live-region **условно монтируется** только при наличии сообщения, а для надёжного объявления регион должен уже существовать в DOM до вставки текста.
3. **Escape не централизован.** Кастомные модалки вешают свой `window`-listener на Escape (4 копии), native-`<dialog>` полагается на встроенный `cancel`. Разные механизмы → дрейф (одна модалка может потерять Escape при рефакторинге).
4. **Дублирование.** 7 раз вручную написаны backdrop, panel, `role="dialog"`, `aria-modal`, header с кнопкой «×». Любой фикс верстки/поведения надо вносить в 7 мест — что и привело к расхождению.

## Цель

Один общий **презентационный, domain-agnostic** `<Dialog>`-примитив на native `<dialog>`, на который мигрируют все 7 модалок, плюс **автоматический guardrail**, не дающий впредь руками писать модалку. Результат: меньше кода, чем сейчас; строго лучше a11y (фон становится `inert`); единая точка для будущих изменений.

Соответствие CLAUDE.md §4: sibling-pattern запрещает «общие на всякий случай» компоненты, **но явно делает исключение для строго презентационных domain-agnostic компонентов**. Dialog-обвязка — ровно этот случай, поэтому консолидация не нарушает философию проекта.

## Не-цели / Out of scope (явно)

- **Inline-формы** (`user-edit`, `partner-edit`, `organization-edit`, `partner-create`, `user-invite`, `admin-rate-override`, `assign-order-manager`, `manager-doc-upload`, `manager-status-change`) — это **не модалки**, они отрисованы прямо на странице. Их feedback-регионы (`role="alert"`/`status"`) уже работают; отдельная сверка их live-region — потенциальная следующая задача, не входит сюда.
- **`<ConfirmDialog>`-обёртка** поверх примитива — YAGNI; confirm-модалки (`lead-withdraw`, `member-row-actions`) просто кладут своё содержимое внутрь `<Dialog>`.
- **Стек модалок** (несколько одновременно открытых) — в кодовой базе такого нет; native top-layer это поддержит позже без переделки примитива.
- **Не-модальные popover/dropdown** — не трогаем.
- **`focus-visible`-кольца** — Tailwind-дефолтов достаточно.

## Дизайн

### `<Dialog>`-примитив — `src/components/ui/dialog.tsx`

Новая папка `src/components/ui/` для domain-agnostic примитивов (сейчас её нет — этот примитив её заводит). **Контролируемый** компонент:

```tsx
type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;                      // → <h2 id={autoId}>; на <dialog> ставится aria-labelledby={autoId}
  size?: 'sm' | 'md' | 'lg' | 'xl';   // → max-w-md / max-w-lg / max-w-2xl / max-w-3xl (default 'md')
  busy?: boolean;                     // mid-submit: блокирует закрытие по Escape и по backdrop
  closeOnBackdrop?: boolean;          // default true
  error?: React.ReactNode;            // → постоянный role="alert"-регион (assertive)
  notice?: React.ReactNode;           // → постоянный role="status"-регион (polite)
  children: React.ReactNode;          // тело (форма / контент)
};
```

`title` — обязательный `string`: единственная гарантия, что у каждой модалки будет доступное имя (`aria-labelledby`). Если когда-то понадобится кастомный заголовок-узел — расширим API явным `titleNode`, но не сейчас (YAGNI).

### Поведение

Базис — native `<dialog open>` через `showModal()`. Что **браузер даёт бесплатно** (ради чего и выбран native): focus-trap, Escape → событие `cancel`, **`inert` фон** (закрывает дефект №1), возврат фокуса на триггер при `close()`, рендер в top-layer (убираем `z-50`-хаки).

Что **примитив добавляет сверху**:

1. **Мост declarative↔imperative.** Один `useEffect` синхронизирует проп `open` с императивным элементом:
   - `open === true` и `!el.open` → `el.showModal()`.
   - `open === false` и `el.open` → `el.close()`.
   - Guard на `el.open` обязателен: `showModal()` на уже открытом `<dialog>` бросает `InvalidStateError`, а React 19 StrictMode в dev вызывает эффекты дважды.
2. **Синхронизация состояния.** Слушаем native-события `cancel` (Escape) и `close` → вызываем `onClose()`, чтобы React-стейт не разъехался с DOM. На `cancel`: если `busy` — `e.preventDefault()` (блокируем Escape во время сабмита), иначе даём закрыться.
3. **Закрытие по backdrop.** Native `<dialog>` сам не закрывается по клику на `::backdrop`. Вешаем `onClick` на сам `<dialog>`: если `e.target === dialogEl` (клик пришёлся на backdrop-область, т.к. контент завёрнут во внутренний `<div>`, который `stopPropagation()`) и не `busy` и `closeOnBackdrop !== false` → `onClose()`.
4. **Initial-focus preference** — единственное, что переносится из `useDialogFocus`: после `showModal()` выбрать первый из `INPUT/TEXTAREA/SELECT` → первый submit-button → первый focusable → сам `<dialog>`. Без этого браузер сфокусировал бы просто первый focusable; проект сознательно держит «сначала поле формы» (решение 2026-05-27). Селектор focusable переносится из старого хука без изменений.
5. **Два постоянных live-region.** Примитив **всегда** рендерит (первыми детьми панели) `<div role="alert" aria-live="assertive">` и `<div role="status" aria-live="polite">`. Пустые → `sr-only` (в DOM есть, визуально скрыты). Текст из пропов `error` / `notice` вставляется в соответствующий регион и стилизуется (красная / зелёная плашка) когда не пуст. Это и есть фикс дефекта №2: регион существует до вставки текста → объявление срабатывает надёжно; ошибки получают `role` даже в бывших native-модалках.

### Разметка примитива (скелет)

```tsx
<dialog ref={dialogRef} aria-labelledby={titleId} className="<base> max-w-…"
        onClick={onBackdropClick} onCancel={onCancel} onClose={onNativeClose}>
  <div className="dialog-panel" onClick={(e) => e.stopPropagation()}>
    <header>
      <h2 id={titleId}>{title}</h2>
      <button type="button" aria-label="Закрыть" onClick={() => !busy && onClose()}>×</button>
    </header>
    <div role="alert"  aria-live="assertive" className={error  ? '<error-box>'  : 'sr-only'}>{error}</div>
    <div role="status" aria-live="polite"    className={notice ? '<notice-box>' : 'sr-only'}>{notice}</div>
    {children}
  </div>
</dialog>
```

`titleId` — через `useId()`. Палитра: оранжевая проектная (`#F97316`/`#EA580C`), heading `#111111` (CLAUDE.md §13). `role="dialog"`/`aria-modal` **не пишем руками** — у native `<dialog>` в модальном режиме они подразумеваются; это же снимает ложноположительные срабатывания guardrail на самом примитиве (см. ниже override).

### Судьба `useDialogFocus`

Логика initial-focus-preference переезжает **внутрь** примитива приватным хелпером. Код Tab-trap и focus-restore **удаляется** (native делает оба). Файл `src/hooks/useDialogFocus.ts` **удаляется** — после миграции у него ноль внешних потребителей (guardrail это гарантирует). Отдельного unit-теста на хук нет: с 2026-05-27 его поведение покрывается только Playwright-спекой `organization-team-modal-focus-trap.spec.ts`, которая после миграции переориентируется на примитив (см. Tests).

### Guardrail — ESLint `no-restricted-syntax` в `eslint.config.mjs`

Три селектора, с `files`-override, исключающим сам примитив (`src/components/ui/dialog.tsx`):

- `JSXOpeningElement[name.name='dialog']` — запрет сырого `<dialog>`.
- `JSXAttribute[name.name='role'][value.value='dialog']` — запрет рукописного `role="dialog"`.
- `JSXAttribute[name.name='aria-modal']` — запрет `aria-modal`.

Message: `«Use the shared <Dialog> primitive (src/components/ui/dialog.tsx) instead of hand-rolling a modal.»`

**Почему ESLint, а не Vitest-скан:** правило работает в уже существующем `lint-staged` pre-commit гейте (CLAUDE.md §6) с обратной связью в IDE на момент редактирования; Vitest-скан сработал бы только на pre-push и давал бы более слабый сигнал. Правило не требует DOM.

### Раскладка файлов

```
src/components/ui/dialog.tsx                                  (new — примитив, ~120 строк)
src/hooks/useDialogFocus.ts                                   (DELETE — после миграции)
eslint.config.mjs                                             (edit — +3 no-restricted-syntax + override)
src/e2e/snapshots/organization-team-modal-focus-trap.spec.ts  (edit — org/div-кейс через примитив)
src/e2e/snapshots/leads-dialog-a11y.spec.ts                   (new — native-кейс; без префикса → partner-проект)
+ 7 модалок из таблицы выше                                   (edit — миграция на <Dialog>)
```

### Миграция 7 модалок

**4 кастомных `<div>` (1–4):** заменить `оверлей + panel + ручной Escape-effect + useDialogFocus` на `<Dialog open onClose title size>…children…</Dialog>`. Убрать импорт `useDialogFocus` и Escape-`useEffect`. Ошибки перенести в проп `error`.
- `audit-diff-dialog` сейчас монтируется родителем только когда открыт и зовёт `useDialogFocus(true)`. Привести к контролируемому виду: компонент принимает `open`/`onClose` (или родитель всегда передаёт `open`); read-only тело (`before`/`after`/`extras`) идёт в `children`, `size='xl'` (max-w-3xl как сейчас).
- `invite-org-user-form`: success-экран (письмо/invite-URL/копирование) остаётся в `children`; **починить unlabeled invite-URL input** — добавить `aria-label="Ссылка приглашения"`. Ошибки → `error`.

**3 native `<dialog>` (5–7):** заменить императив (`dialogRef.showModal()/.close()` + функция `open()`) на `open`-стейт + `<Dialog>`. Title-проп автоматически добавит недостающий `aria-labelledby`. Feedback-`<div>` без role → проп `error`.
- `invite-member-form`: многошаговая форма (роль, выбор организаций) — целиком в `children`; `size='lg'`.
- `lead-withdraw-button` / `member-row-actions`: confirm-тело в `children`; `size='md'`/`'sm'`.

### Порядок сборки (rollout)

1. Ветка от `main`: `claude/modal-dialog-primitive` (уже создана).
2. Реализовать примитив `src/components/ui/dialog.tsx` + Playwright-спеку.
3. Мигрировать по одному представителю каждого механизма — `invite-org-user-form` (div) и `lead-withdraw-button` (native) — чтобы доказать, что API ложится на обе формы.
4. Мигрировать оставшиеся 5 модалок.
5. Удалить `src/hooks/useDialogFocus.ts` (+ его тест, если есть).
6. Добавить ESLint-guardrail **последним** (раньше — лишний шаг сломал бы lint на ещё не мигрированных файлах).
7. `npm run typecheck && npm run lint && npm run test:unit` — зелёные; Playwright a11y-спека — зелёная; ручной keyboard-проход по всем 7 модалкам.
8. PR со ссылкой на этот spec.

## Tests

**Ограничение окружения:** Vitest сконфигурирован `environment: 'node'` ([vitest.config.ts:65](../../../vitest.config.ts)) и тестирует компоненты через `renderToString` — **нет DOM, событий, фокуса**. `jsdom` **не добавляем** (решение унаследовано от 2026-05-27). Значит:

- **Поведение примитива (native `<dialog>`: `showModal`, Escape, `inert`, фокус, backdrop) → Playwright.** Specs лежат плоско в `src/e2e/snapshots/`, проект выбирается по префиксу имени файла (`manager-*` / `organization-*` / иначе partner — CLAUDE.md §6). Покрыть по одному мигрированному представителю каждого механизма: div-кейс — расширить существующую `organization-team-modal-focus-trap.spec.ts` (org-проект, мигрированный `invite-org-user-form`); native-кейс — новая `leads-dialog-a11y.spec.ts` (без префикса → partner-проект, мигрированный `lead-withdraw-button` на странице leads). Каждая проверяет:
  1. initial-focus падает на первое поле формы;
  2. Escape закрывает и **возвращает фокус на триггер**;
  3. фон `inert` — ссылка в шапке/сайдбаре не фокусируется, пока модалка открыта (регрессионный тест на дефект №1);
  4. клик по backdrop закрывает;
  5. при `busy=true` Escape и backdrop **не** закрывают;
  6. Tab от последнего focusable не уходит в фон (оборачивается).
- **Guardrail:** `npm run lint` остаётся зелёным на мигрированном дереве; рукописный `role="dialog"` в любом не-примитивном файле обязан ронять линт (разовая ручная проверка при добавлении правила).
- **Существующие unit-тесты:** `src/__tests__/components.admin-audit-diff-dialog.test.tsx` (renderToString) проверяет наличие `role="dialog"`/`aria-labelledby`. Примитив всё ещё эмитит доступное имя через `aria-labelledby` (от `title`), но `role="dialog"` теперь неявный (native). Ожидаются **точечные правки селекторов** этого теста (проверять по `aria-labelledby` / тексту заголовка, а не по литералу `role="dialog"`), не переписывание.

## Принятые решения (зафиксировано по делегированию пользователя)

1. **Базис — native `<dialog>`** (не кастомный `<div>`): единственный вариант, который закрывает дефект `inert`-фона, а не тиражирует его; меньше кода; 2 модалки уже на нём.
2. **Расположение примитива — `src/components/ui/dialog.tsx`** (новая `ui/`-папка для презентационных примитивов).
3. **Guardrail — ESLint**, а не Vitest-скан (интеграция в pre-commit гейт, фидбэк в IDE).
4. **`useDialogFocus` удаляется** (не остаётся тонким хуком): после миграции потребителей нет, guardrail это держит.
5. **Inline-формы вне scope.**

## Риск

Низкий–средний.

- **Поддержка браузеров:** native `<dialog>`/`showModal()` — все evergreen-браузеры с 2022 (Chrome 37+, Firefox 98+, Safari 15.4+). Для B2B-кабинета 2026 года достаточно. *Если есть требование на легаси-браузеры — поднять флаг до реализации.*
- **`showModal()` бросает на уже открытом/disconnected узле** и при двойном вызове эффектов в StrictMode — закрыто guard'ом `el.open` в мосте.
- **Backdrop-детект** (`e.target === dialogEl`) при ошибке закрывал бы по кликам внутри — покрыто Playwright-ассертом + `stopPropagation()` на внутренней панели.
- **Худшая правдоподобная регрессия:** не то поле получает initial-focus — покрыто тестом, который ассертит конкретный элемент, + ручной keyboard-проход.
- Поведение для не-keyboard / не-AT пользователей (мышь) не меняется.
