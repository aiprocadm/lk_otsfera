# Modal `<Dialog>` Primitive + a11y Migration + Guardrail — DONE

**Дата завершения:** 2026-05-30
**Base commit:** `6395342` (точка ответвления от `main`)
**Head commit:** `ba9b840` (chore(lint): guardrail — forbid hand-rolled modals outside `<Dialog>`)
**Merge commit:** `1ac7470` в `main` (2026-05-30 07:00:56Z)
**Branch:** `claude/modal-dialog-primitive`
**Связанный PR:** #78 — *«a11y: shared `<Dialog>` primitive + migrate 7 modals + guardrail»* (MERGED; spec + plan + impl в одном PR)
**Plan:** [2026-05-30-modal-dialog-primitive.md](2026-05-30-modal-dialog-primitive.md)
**Spec:** [2026-05-30-modal-dialog-primitive-design.md](../specs/2026-05-30-modal-dialog-primitive-design.md)

## Что готово

### Примитив — `src/components/ui/dialog.tsx` (new)
- `pickInitialFocus()` (`16f3027`) — чистый, DOM-agnostic хелпер initial-focus preference (form-control → submit → first focusable → fallback). Юнит-тестируется под `environment: node` без DOM.
- `<Dialog>` (`6f5d483`) — контролируемый примитив на native `<dialog>` + `showModal()`. Браузер даёт focus-trap, Escape, **`inert` фон**, top-layer, focus-restore; примитив добавляет: declarative↔imperative мост (`open` ↔ `showModal()/close()` с guard на `el.open`), unmount-close (focus-restore при размонтировании), backdrop-close (`e.target === dialogEl` + `stopPropagation()` на панели), form-control-first initial focus, и **два постоянных `aria-live`-региона** (`role="alert"`/assertive для `error`, `role="status"`/polite для `notice`, `sr-only` когда пусто). `busy` блокирует Escape/backdrop/× во время сабмита.
- Новая папка `src/components/ui/` для domain-agnostic презентационных примитивов.

### Мигрировано 7 модалок
| # | Файл | Механизм до | Commit |
|---|---|---|---|
| 1 | `organization/invite-org-user-form.tsx` (div-эталон) + label invite-URL | `<div>` + `useDialogFocus` | `742becc` |
| 2 | `partner/lead-withdraw-button.tsx` (native-эталон) | native `<dialog>` | `0a8aef0` |
| 3 | `partner/invite-customer-admin-form.tsx` + label invite-URL | `<div>` + `useDialogFocus` | `ec5ebf7` |
| 4 | `admin/assign-or-invite-manager-form.tsx` (mode-tabs) + label invite-URL | `<div>` + `useDialogFocus` | `1570385` |
| 5 | `admin/audit-diff-dialog.tsx` (read-only, `size='xl'`) | `<div>` + `useDialogFocus` | `cb8725b` |
| 6 | `partner/invite-member-form.tsx` (multi-field, `size='lg'`) | native `<dialog>` | `123ad00` |
| 7 | `partner/member-row-actions.tsx` (**две** модалки) | native `<dialog>` | `d913b13` |

Все 7 теперь — чистый `open`/`onClose`-стейт; убраны ручные оверлеи, панели, Escape-`useEffect`'ы, условно-монтируемые error-`<div>`'ы (→ проп `error`). Закрыты дефекты спеки: фон стал `inert`; feedback в bывших native-модалках получил `role`; native-модалки получили `aria-labelledby` через `title`; три read-only invite-URL input'а получили `aria-label='Ссылка приглашения'`.

### Удалён `useDialogFocus`
- `src/hooks/useDialogFocus.ts` удалён (`575fa24`) — после миграции ноль внешних потребителей; Tab-trap и focus-restore теперь даёт native `<dialog>`. Logic initial-focus переехала внутрь примитива.
- Из `components.admin-audit-diff-dialog.test.tsx` убран мёртвый `vi.mock('@/hooks/useDialogFocus')` (`cb8725b`).

### Guardrail — `eslint.config.mjs`
- `no-restricted-syntax` (`ba9b840`): запрет сырого `<dialog>`, рукописного `role="dialog"`, `aria-modal` — с `files`-override, исключающим сам примитив `src/components/ui/dialog.tsx`. Срабатывает в `lint-staged` pre-commit гейте.

### Тесты
- `src/__tests__/components.ui-dialog.test.tsx` (new, `16f3027`/`6f5d483`) — **7 unit-тестов**: 4 на `pickInitialFocus` + 3 на SSR-контракт `<Dialog>` (accessible name, assertive/polite live-region'ы).
- `src/e2e/snapshots/leads-dialog-a11y.spec.ts` (new, `c828a32`) — Playwright native-кейс (partner-проект).
- `src/e2e/snapshots/organization-team-modal-focus-trap.spec.ts` (extended, `c828a32`) — + ассерт inert-фона.

## Проверка состояния

```
npm run typecheck   # clean (0 errors)
npm run lint        # ✔ No ESLint warnings or errors (guardrail зелёный на мигрированном дереве)
npm run test:unit   # 102 files / 880 tests passed (incl. 7 новых components.ui-dialog + 3 audit-diff)
```

Выполнено повторно 2026-05-30 (post-merge re-verify) — всё зелёное.

## Что НЕ готово

**Нет планируемой следующей фазы.** Реализованы оба явно отложенных в [2026-05-27](2026-05-27-modal-focus-trap-design.md) пункта: полноценный `<Dialog>`-примитив и `inert`-фон.

**Deferred (manual tier, требует seeded dev на :3000 + Postgres/Redis/Supabase):**
- [ ] **Ручной keyboard-проход по всем 7 модалкам** (Task 13 Step 2) — initial focus, Tab/Shift+Tab wrap, inert-фон, Escape+restore, busy-блокировка, объявление ошибки. Откладывается на dev-сессию с запущенным приложением.
- [ ] **Playwright `npm run e2e:visual`** (Task 13 Step 3) — org focus-trap (incl. inert) + leads-dialog a11y specs. Требует `npm run dev` + seed; запускается только локально вручную (CLAUDE.md §6).

**Out-of-scope (намеренно, из спеки):**
- Inline-формы (`user-edit`, `partner-edit`, `*-create`, `manager-doc-upload`, …) — не модалки; их live-region'ы уже работают. Отдельная сверка — потенциальная следующая задача.
- `<ConfirmDialog>`-обёртка — YAGNI; confirm-модалки кладут содержимое прямо в `<Dialog>`.
- Стек одновременно открытых модалок — в кодовой базе нет; native top-layer поддержит позже без переделки.
- Не-модальные popover/dropdown — не трогаем.

## Сознательные упрощения (не баги)

1. **Test env `node`, без jsdom** — поведение примитива (`showModal`, Escape, focus, inert, backdrop) проверяется в Playwright (manual tier); unit-тесты покрывают только `pickInitialFocus` + SSR-структуру. Решение унаследовано от 2026-05-27.
2. **`role="dialog"`/`aria-modal` не пишутся руками** — native `<dialog>` в модальном режиме их подразумевает; это же снимает ложные срабатывания guardrail на самом примитиве.
3. **`title` — обязательный `string`** — единственная гарантия accessible name для каждой модалки. Кастомный заголовок-узел отложен до явной нужды (YAGNI).
4. **`member-row-actions`: две модалки делят один `error`-стейт** — одновременно открыта только одна, каждый триггер чистит `error` на open.
5. **`audit-diff-dialog`: `open` константно `true`** — родитель монтирует компонент только когда открыт; unmount-close эффект примитива восстанавливает фокус при размонтировании.
6. **Guardrail — ESLint, не Vitest-скан** — интеграция в существующий pre-commit гейт + фидбэк в IDE на момент редактирования.

## Метрики

- **Коммитов в работе:** 14 (2 docs: spec `0750917` + plan `5cb2979`; 12 impl/test/lint).
- **Новых файлов:** 3 — `ui/dialog.tsx`, `components.ui-dialog.test.tsx`, `leads-dialog-a11y.spec.ts` (+ 2 docs).
- **Удалённых файлов:** 1 — `hooks/useDialogFocus.ts`.
- **Мигрировано модалок:** 7 (8 диалогов — `member-row-actions` несёт два).
- **Новых тестов:** 7 unit + 1 e2e spec + inert-ассерт в org-спеке.
- **Diff (incl docs):** 16 файлов, +2069 / −682.

## Deviations от плана

1. **Spec + plan + impl в одном PR (#78)** — в отличие от focus-trap работы (spec в #61, impl в #62), весь scope ушёл одной веткой/одним PR. Никаких функциональных отклонений от плана; все 13 задач исполнены в порядке плана.
2. **Manual-tier шаги (keyboard pass, Playwright) выполнены не были на момент merge** — отложены на dev-сессию с running app (см. «Что НЕ готово»). Автоматический гейт (typecheck/lint/unit) — зелёный.

## Test plan (выполнено)

- [x] `npm run typecheck` — clean
- [x] `npm run lint` — no warnings/errors (guardrail активен и зелёный)
- [x] `npm run test:unit` — 880/880 passed
- [x] Code review примитива — guard на `el.open`, unmount-close, backdrop через `stopPropagation()`
- [ ] Playwright e2e (`npm run e2e:visual`) — deferred (needs dev + seed)
- [ ] Ручной keyboard-проход по 7 модалкам — deferred (needs running app)

---

**Operational notes:**
- Любая новая модалка обязана идти через `<Dialog>` — ESLint guardrail роняет сборку на сыром `<dialog>`/`role="dialog"`/`aria-modal` везде, кроме `src/components/ui/dialog.tsx`.
- `error`/`notice` — это постоянные `aria-live`-региона; никогда не возвращай условно-монтируемый error-`<div>` внутрь тела модалки.
- Поддержка браузеров: native `<dialog>`/`showModal()` — все evergreen с 2022. Для B2B-кабинета 2026 достаточно.
