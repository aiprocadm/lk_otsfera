# Этап 2 «UI больше не молчит + лимиты» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** форма импорта перестаёт молчать, когда запрос не дошёл до сервера, а
предел размера файла становится одним числом вместо трёх разных.

**Спека:** [2026-08-05-stage2-1c-ui-limits-design.md](../specs/2026-08-05-stage2-1c-ui-limits-design.md) — подтверждена заказчиком 05.08.2026.
**ТЗ:** [починка импорта 1С](../../tz/2026-08-04-tz-fix-1c-import.md), §2 «Этап 1», Т-4…Т-7.

## Global Constraints

- Объём — строго Т-4…Т-7. Алиасы листов, `.xls`, сигнатура файла — этап 3.
- Целевой предел — **25 МБ** (подтверждён заказчиком).
- Схема БД, права и контракты сервисов не меняются; миграций нет.
- Сырой `console.*` в `src/**` запрещён — только `@/lib/logging/client`.
- Порог покрытия 100% на `src/**`; ветка `stage2-1c-ui-limits`, PR #312.

---

### Задача 1: единая константа предела

**Файлы:**
- Создать: `src/lib/config/import-limits.ts`
- Изменить: `next.config.mjs` (`bodySizeLimit` 10 → 25 МБ + экспорт числа)
- Тест: `src/__tests__/lib.config.import-limits.test.ts`

```ts
export const IMPORT_MAX_FILE_MB = 25;
export const IMPORT_MAX_FILE_BYTES = IMPORT_MAX_FILE_MB * 1024 * 1024;
```

- [ ] **Шаг 1:** тест-сверка: `SERVER_ACTIONS_BODY_LIMIT_MB` из `next.config.mjs`
      равен `IMPORT_MAX_FILE_MB`; байты = МБ × 1024².
- [ ] **Шаг 2:** прогнать — падает (модуля нет).
- [ ] **Шаг 3:** реализовать константу и правку конфига.
- [ ] **Шаг 4:** зелёный.

---

### Задача 2: серверные действия читают константу

**Файлы:**
- Изменить: `src/server-actions/import.ts`, `src/server-actions/payment-import.ts`
- Тест: `src/__tests__/server-actions.import.test.ts` (дополнить)

Локальные `IMPORT_MAX_XLSX_BYTES` / `MAX_BYTES` удаляются, оба действия
используют `IMPORT_MAX_FILE_BYTES`.

- [ ] **Шаг 1:** тест: файл `IMPORT_MAX_FILE_BYTES + 1` → `invalid_file`;
      файл ровно по пределу проходит гард.
- [ ] **Шаг 2–4:** реализовать, зелёные.

---

### Задача 3: общий словарь текстов ошибок (Т-7)

**Файлы:**
- Создать: `src/components/import/error-messages.ts`
- Тест: `src/__tests__/components.import-error-messages.test.ts`

```ts
export const IMPORT_ERROR_CODES = [
  'forbidden', 'invalid_file', 'file_too_large', 'empty',
  'parse_failed', 'network_or_server',
] as const;
export const XLSX_IMPORT_ERRORS: Record<ImportErrorCode, string>;
export const PAYMENT_IMPORT_ERRORS: Record<ImportErrorCode, string>;
export function errorMessage(map: Record<string, string>, code: string): string;
```

Тексты у форм разные (одна принимает только `.xlsx`, другая ещё и `.xls`),
поэтому карты две, а список кодов — один. Тип `Record<ImportErrorCode, string>`
делает пропуск текста ошибкой сборки; тест дополнительно требует, чтобы текст
был русским и непустым.

- [ ] **Шаг 1:** тест полноты обеих карт + fallback «Ошибка: `<код>`».
- [ ] **Шаг 2–4:** реализовать, зелёные.

---

### Задача 4: формы перестают молчать (Т-4, Т-6)

**Файлы:**
- Изменить: `src/components/import/import-form.tsx`,
  `src/components/import/payment-import-form.tsx`
- Тесты: `components.import-form.interactive.test.tsx`,
  `components.payment-import-form.interactive.test.tsx` (дополнить)

В обоих обработчиках (предпросмотр и подтверждение):

```ts
if (file.size > IMPORT_MAX_FILE_BYTES) {
  setPreview({ ok: false, error: 'file_too_large', detail: `Ваш файл — ${mb} МБ.` });
  return; // запрос не уходит вовсе (Т-6)
}
try { … } catch (e) {
  clientLog.error('[1c-import] запрос не дошёл до сервера', e);
  setPreview({ ok: false, error: 'network_or_server' });
} finally { setIsPreviewing(false); }
```

Состояние отказа получает необязательное поле `detail` — в нём фактический
размер файла; текст с пределом живёт в словаре.

- [ ] **Шаг 1:** тесты: отклонённый промис → красный блок, кнопка снова активна;
      файл больше предела → действие **не вызвано**, показан размер; файл в
      пределах → действие вызвано. Для обеих форм.
- [ ] **Шаг 2–4:** реализовать, зелёные.

---

### Задача 5: гейты и документация

- [ ] `npm run typecheck`, `npm run lint`, `npx prettier --check .`
- [ ] адресное покрытие изменённых файлов — 100% по четырём метрикам
- [ ] полный `npm run test:unit` (без `. ./.env`)
- [ ] CHANGELOG.md, STATUS.md (этап 2 → 🔍 PR), close-out
- [ ] «Задел на будущее» в STATUS.md: молчаливое обрезание загрузки документов
      на общем `bodySizeLimit` (находка §7 спеки, вне Т-номеров)
- [ ] PR #312 из черновика: описание под реализацию
