# Пакет мелких пробелов ТЗ (gap #4) — Close-out

**Дата:** 2026-06-24
**Ветка:** `claude/tz-gap4-package` (от main `23d9b4e`)
**Spec:** [2026-06-24-tz-gap4-package-design.md](../specs/2026-06-24-tz-gap4-package-design.md) · **Plan:** [2026-06-24-tz-gap4-package.md](2026-06-24-tz-gap4-package.md)
**Память:** [[project-tz-v04-gap-program-2026-06-23]] gap #4.

## Что отгружено

Четыре пробела ТЗ одним PR (spec → plan → subagent-driven impl → holistic review):

### A. §11 — лимит файла 200 МБ из единого источника
- Новый client-safe модуль [src/lib/config/upload.ts](../../../src/lib/config/upload.ts): `DEFAULT_MAX_FILE_SIZE_MB=200`, `resolveMaxFileSizeMb()` (env-override + валидация), `maxFileSizeBytes()`, единый `ALLOWED_MIME_TYPES`.
- На него переведены ВСЕ surface-ы загрузки: `documents/upload-core.ts`, `api/documents/upload/route.ts`, `chat/attachments.ts`, `partner/leadAttachments.ts` + клиентские лейблы (dropzone, org-формы) + `errorMessageRu.too_large` (без числа).
- `import.ts` лимит парса xlsx остаётся 20 МБ намеренно (операторский файл, не пользовательский документ) — переименован в `IMPORT_MAX_XLSX_BYTES`.

### B. §13 — формат .doc
- `application/msword` добавлен в единый allow-list (upload-core) и в admin-роут.
- **ASSUMPTION (открыта):** полный список §13 не сверён с ТЗ (документа нет в репо). Расширение allow-list = 1 строка; ждёт подтверждения владельца.

### C. §9.1 — история ставок комиссии с датами
- Модель `CommissionRateChange` (append-only) + миграция.
- Запись истории в `admin/partners.ts` (`updatePartner`/`createPartnerWithAdmin`) ТОЛЬКО при реальной смене ставки (Decimal `.equals`); в той же транзакции.
- Read-сервис `commission/rateHistory.ts` (`listRateHistory`, admin-only, Result-тип) + таблица на `/admin/partners/[id]`.
- **Расчётчик комиссий НЕ тронут** — история audit/display-only (verified: diff `calculator.ts`/`calculate-monthly-commissions.ts` пуст).

### D. §7.1 — поля оплаты
- `Payment` + `vatAmount`/`purpose`/`paymentOrderNumber`/`enteredById` (миграция аддитивна, всё nullable; FK `enteredById→User` ON DELETE SET NULL).
- Проброшены сквозь весь write-путь: `schemas.ts` → `mappers.ts` → `column-map.ts` → `parse-workbook.ts` → **оба** адаптера (`adapter-file` Excel + `adapter-rest` live-1C) → `writers.ts` (create+update). Платёж по-прежнему пишется ТОЛЬКО через `writers.ts` (guardrail зелёный).
- Показ в леджере платежей (org + manager sibling через общий `OrgPaymentRow`); `vatAmount` сериализуется в строку на границе RSC.
- `enteredById` пока `null` (WriteCtx не несёт актора) — задел под ручной ввод/проброс актора импорта (future work, §7.1).

## Гейты

- `typecheck` ✓ · `lint` ✓ (0 warnings)
- **unit: 3135 passed, 3 skipped, 0 failed** (289 файлов)
- integration (живой PG, touched): `commission.rateHistory` + `organization.finance` 11/11 ✓; `oneCSync.writers`/`import.no-second-writer` guardrail ✓; `adapter-file` round-trip ✓
- Миграция применена через `migrate diff`→`migrate deploy` (не `dev`); БД `cabinet` актуальна.
- **Holistic review (opus): SHIP WITH MINOR FIXES** → IMPORTANT (file-import adapter не пробрасывал поля §7.1) **исправлен** + e2e-тест; minors (route/config MIME-списки расходятся — pre-existing, defensible; `enteredById=null` — documented) приняты.

## Остаток / follow-up

- Подтвердить полный список форматов §13 (ASSUMPTION) — затем 1 строка в `ALLOWED_MIME_TYPES`.
- Сверить колонки `column-map.ts` (`НДС`, `№ платёжного поручения`) с реальной выгрузкой 1С перед go-live (SAMPLE-LOCKED).
- При появлении ручного ввода платежа — заполнять `enteredById` актором.
- Прод pre-check: новые поля nullable → backfill не нужен.

## Коммиты (12)

config/upload single-source → wire upload-core/route → UI labels → unify chat+lead → admin route .doc → docs → schema+migration → rate-history (write/read/UI ×3) → payment fields (write/ledger ×2) → file-import adapter fix.
