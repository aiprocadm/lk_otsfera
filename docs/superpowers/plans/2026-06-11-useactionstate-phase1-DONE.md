# useActionState Фаза 1 — хук `useFormAction` + 7 форм — DONE

> Companion close-out to [2026-06-11-useactionstate-phase1.md](2026-06-11-useactionstate-phase1.md). Spec: [../specs/2026-06-11-useactionstate-forms-design.md](../specs/2026-06-11-useactionstate-forms-design.md).

**Дата:** 2026-06-11 · **Ветка:** `claude/useactionstate-phase1` (стекирована на `claude/useactionstate-spec`) · **Метод:** T1 — оркестратор, T2–T4 — параллельный диспатч 3 агентов по непересекающимся файлам + холистическое ревью.

## Что отгружено

| Таск | Файлы |
|---|---|
| T1 хук | `src/lib/ui/useFormAction.ts` (+4 unit в `lib.useFormAction.test.tsx`): typed Result §3, `resolveErrorText` (errorMap > errorMessageRu > видимый fallback), `reset()` через generation-счётчик, `refresh` opt-in (default false) |
| T2 admin edit | `user-edit-form`, `partner-edit-form`, `organization-edit-form` — `translateError`-switch'и → `errorMap`-литералы |
| T3 admin create/invite | `partner-create-form`, `user-invite-form` — success-payload (`inviteUrl`) через типизированный `data` |
| T4 остаток | `assign-order-manager-form` (нативная FormData: hidden `orderId` + `name` на селекте), `manager-status-change-form` (action принимает объект → клиентский адаптер FormData→объект, server-action не тронут) |

Итого: −80 строк нетто; из 7 форм удалены `useTransition` + pending/error/success-`useState` + 7 локальных error-словарей (в `errorMap` остались только дельты от `errorMessageRu`).

## Верификация

`npm run typecheck` clean · `npm run lint` 0/0 · `npm run test:unit` **1368** (+4 hook) · `npm run build` успех. Компонентных тестов на мигрированные формы не существовало — ломать нечего.

## Решения / нюансы

1. **Feedback-паритет при ресабмите:** оба миграционных агента независимо заметили, что `useActionState` держит старый error во время `pending`, а оригиналы чистили его в начале сабмита → хук подавляет `errorText/data/success` при `pending` (фикс в T1 после T2–T4).
2. **`ActionResult<void>`-инференс:** action, возвращающий голый `{ ok: true }`, ломает вывод `T` (→ `never`); обход — явный `useFormAction<object>` на call-site. Известная бородавка; если будет раздражать в Фазе 2 — лечить перегрузкой сигнатуры, не правкой call-site'ов.
3. `refresh: true` не понадобился НИ одной форме Фазы 1 — все полагаются на `revalidatePath` внутри server-actions. Дефолт false подтверждён практикой.
4. unused-vars в проекте НЕ игнорирует `_`-префикс — `void ok;` вместо `_ok`.

## Остаток по спеку

Фаза 2 (3 Dialog-инвайта), Фаза 3 (uploads), Фаза 4 (8 кабинетных fetch-форм через sibling `useFetchSubmit`; auth исключён — spec §7 решён).
