# Plan: useActionState Фаза 1 — хук `useFormAction` + кластер 1 (7 форм)

> Spec: [2026-06-11-useactionstate-forms-design.md](../specs/2026-06-11-useactionstate-forms-design.md) (§4 Фаза 1). REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Scope:** только формы кластера 1 БЕЗ Dialog (Dialog-инвайты `assign-or-invite-manager`, `invite-org-user`, `invite-customer-admin` — Фаза 2). Итого 7 форм: admin ×6 (`assign-order-manager`, `organization-edit`, `partner-create`, `partner-edit`, `user-edit`, `user-invite`) + manager ×1 (`status-change`).

**Поведенческий инвариант:** разметка и UX каждой формы сохраняются 1:1 (тот же inline-error `role="alert"`, тот же success-блок, тот же текст кнопок). Меняется только state-машинерия: `useTransition`+`useState(error/success)` → `useFormAction`. `router.refresh()` НЕ добавляется формам, которые его не делали (`refresh: false` по умолчанию в Фазе 1 — см. spec §6).

## Задачи

- [ ] **T1. Хук `useFormAction`** — `src/lib/ui/useFormAction.ts` (`'use client'`):
  - поверх React 19 `useActionState`; параметры: `action(formData) → Promise<ActionResult<T>>`, `errorMap?`, `onSuccess?(data)`, `refresh?: boolean` (default false в Фазе 1);
  - возвращает `{ formAction, pending, errorText, data, success, reset }`;
  - локализация: `errorMap[code] ?? errorMessageRu(code, 'Ошибка: ' + code)` — вынесена в **экспортируемую чистую** `resolveErrorText(code, errorMap?)`;
  - unit: чистая `resolveErrorText` (приоритет errorMap > словарь > fallback) + renderToString-пробник начального состояния (`import React`, classic JSX). Интерактивные переходы покрываются typecheck + build + ручным preview (RTL в проекте нет — не добавлять).
- [ ] **T2. Admin «edit»-тройка**: `user-edit-form`, `partner-edit-form`, `organization-edit-form` → `useFormAction`; локальные `translateError` → `errorMap`-литералы (дельты, которых нет в `errorMessageRu`).
- [ ] **T3. Admin «create/invite»-пара**: `partner-create-form`, `user-invite-form` — success-state с `inviteUrl` через `data` из хука; `reset()` для «создать ещё».
- [ ] **T4. Остаток**: `assign-order-manager-form` (admin), `manager-status-change-form` (manager) — паттерны с feedback-state; сохранить существующие ERROR_LABELS-тексты как `errorMap`.
- [ ] **T5. Холистическое ревью + полный гейт** (typecheck / lint / test:unit / build) + close-out.

T1 — последовательно (T2–T4 зависят от хука); T2–T4 — параллельно (непересекающиеся файлы).
