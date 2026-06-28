# Spec: единый submit-хук форм на `useActionState` (Tier 2, остаток)

**Дата:** 2026-06-11 · **Статус:** approved — открытые вопросы §7 решены 2026-06-11, можно реализовывать.
**Контекст:** close-out [frontend-tier2-dedup-DONE](../plans/2026-06-11-frontend-tier2-dedup-DONE.md), пункт «Отложено №1». Инвентаризация выполнена read-only агентом 2026-06-11 по всему `src/components/**`.

## 1. Проблема

В проекте **26 клиентских форм** и **0 использований `useActionState`/`useFormStatus`** (React 19 уже в стеке). Каждая форма вручную собирает один и тот же boilerplate: `useState` для pending/error/success, `useTransition` вокруг server-action или ручной `fetch`, локальный словарь ошибок (ERROR_LABELS / translateError / ERROR_LABEL_RU — коды `validation|forbidden|not_found|too_large|invalid_mime|storage` продублированы 5+ раз при живом `errorMessageRu` из [messages.ts](../../../src/lib/errors/messages.ts)), `router.refresh()` после успеха. Паттерны разъехались: 9 форм на `<form action>` + `useTransition`, 10 на ручном `fetch`, 4 с sonner-toast, остальные с inline-`<p>`.

## 2. Инвентарь (сводка)

| Кластер | Форм | Состав |
|---|---|---|
| **1. server-action + ERROR_LABELS** | 9 | admin `assign-order-manager`, `organization-edit`, `partner-create`, `partner-edit`, `user-edit`, `user-invite`; manager `status-change`; org `invite-org-user`; partner `invite-customer-admin` (2 actions по source) |
| **2. Dialog-инвайты с success-state (inviteUrl + copy)** | 3 | `assign-or-invite-manager`, `invite-org-user`, `invite-customer-admin` (пересекаются с кластером 1) |
| **3. ручной fetch к API-роутам** | 10 | auth `login`, `reset-password`; partner `add-comment`, `invite-member`, `lead-create`, `lead-withdraw`, `manual-calc` (**сырая DIV-модалка** — нарушение §9), `member-row-actions`, `rate-override`; manager `order-less-upload` |
| **4. file-upload (FormData) + errorMessageRu** | 5 | manager `doc-upload`; org `document-upload`, `order-less-upload`; partner `document-upload`; shared `documents-panel` |
| **5. особые случаи — вне scope** | 3 | `chat-composer` (callback, не форма), `import-form` (двухэтапный preview→commit), `rate-override` (кнопки-действия, 2 сабмита) |

Ключевой факт инвентаризации: **все** server-actions уже следуют Result-контракту §3 (`{ ok: true } & T | { ok: false; error: ErrorCode }`) — хук можно типизировать дженериком поверх него без миграции контрактов.

## 3. Дизайн

### 3.1 Хук `useFormAction` — `src/lib/ui/useFormAction.ts`

Тонкая обёртка над React 19 `useActionState`, типизированная Result-контрактом:

```ts
type ActionResult<T> = ({ ok: true } & T) | { ok: false; error: string };

function useFormAction<T = object>(opts: {
  action: (formData: FormData) => Promise<ActionResult<T>>;
  /** Переопределения поверх errorMessageRu(); дефолт — errorMessageRu(code). */
  errorMap?: Record<string, string>;
  /** После ok:true — toast/onClose/копирование; router.refresh() хук делает сам (opt-out refresh:false). */
  onSuccess?: (data: T) => void;
}): {
  formAction: (formData: FormData) => void; // в <form action={...}>
  pending: boolean;                          // → Dialog busy / disabled
  errorText: string | null;                  // локализованная строка → Dialog error / inline <p>
  data: T | null;                            // success-payload (inviteUrl и т.п.)
  reset: () => void;                         // сброс error/data (повторное открытие модалки)
};
```

Принципиальные решения:

- **Хук ничего не рендерит.** Dialog-формы передают `pending`/`errorText` в существующие пропсы `busy`/`error` примитива `Dialog` (§9); inline-формы рендерят `errorText` сами. Никакого `enableDialog`-флага.
- **Toast-agnostic:** sonner вызывается из `onSuccess` теми формами, которым он нужен; хук не импортирует toast.
- **Локализация ошибок — единая:** дефолт `errorMessageRu(code)`, форма докидывает только свои специфичные коды через `errorMap`. Локальные словари ERROR_LABELS удаляются по мере миграции.
- **FormData-friendly:** сигнатура action — `(formData: FormData)`, что нативно для `<form action>`; кластер 4 (upload) покрывается без спецветки.
- Формы с 2+ сабмитами (кластер 5) и многоэтапный `import-form` **не натягиваются** на хук — остаются как есть.

### 3.2 Что НЕ делаем

- **Не конвертируем API-роуты в server-actions ради хука.** Асимметрия manager-upload (API-роут) vs org-upload (server-action) — задокументированное намеренное расхождение (CLAUDE.md §11); manager-роут — эталон тонкого роута §3. Для кластера 3 — открытый вопрос §7.1.
- Не трогаем `useFormStatus` — вложенных generic-submit-кнопок нет, `pending` из хука достаточно.

## 4. Фазы миграции

1. **Фаза 1 — хук + кластер 1** (9 форм на server-actions): чистая замена `useTransition`+`useState` → `useFormAction`; локальные ERROR_LABELS → `errorMap`-дельты поверх `errorMessageRu`. TDD: unit на хук (`renderToString`-паттерн + classic JSX `import React`), существующие form-тесты остаются зелёными.
2. **Фаза 2 — Dialog-инвайты** (кластер 2): `data` несёт `inviteUrl/email/alreadyHasPassword`; `reset()` при повторном открытии; Dialog `busy`/`error` из хука.
3. **Фаза 3 — uploads** (кластер 4, 3 формы уже на server-actions): FormData-путь; sonner — в `onSuccess`.
4. **Фаза 4 — fetch-формы** (кластер 3) — после решения §7.1. Независимо от решения: `manual-calc-form` мигрирует с сырой DIV-модалки на `Dialog`-примитив (закрывает нарушение guardrail `NO_HANDROLLED_MODAL` — сейчас это единственный обход).

Каждая фаза — отдельный PR с полным гейтом (typecheck/lint/test:unit/build); фазы независимы, между ними можно останавливаться.

## 5. Тестовая стратегия

- Unit на сам хук: success-путь (data, onSuccess, refresh), error-путь (errorMap-приоритет над errorMessageRu, неизвестный код → generic), pending-переходы, reset.
- Регресс: существующие unit-тесты мигрируемых форм должны остаться зелёными **без правок** там, где они ассертят разметку, и с минимальными правками там, где мокался `useTransition`.
- Vitest classic JSX: `import React` обязателен в новых тест-файлах.

## 6. Риски

- `useActionState` меняет момент сброса формы (uncontrolled inputs сбрасываются при action-submit) — формы с controlled-инпутами (`lead-create`) проверять руками через preview.
- `router.refresh()` внутри хука по умолчанию: для форм, которые сейчас НЕ рефрешат, это поведенческое изменение — на миграции сверять и при необходимости `refresh: false`.

## 7. Открытые вопросы — РЕШЕНЫ (2026-06-11, «наиболее эффективный» критерий)

1. **Кластер 3 (10 fetch-форм): принят вариант (б) — sibling-хук `useFetchSubmit`** с тем же возвращаемым контрактом (`formAction/pending/errorText/data/reset`). API-роуты не трогаем: `auth/login` и `partner/leads` — рабочие эталонные «тонкие роуты §3», их конвертация — риск без выгоды; DRY-выгода достигается в компонентах единым контрактом обоих хуков.
2. **auth-формы (`login`, `reset-password`) — исключены из scope.** До-кабинетные, без Result-контракта на сервере, login security-чувствителен. Фаза 4 покрывает только кабинетные fetch-формы (8 шт.: partner ×7, manager ×1).
