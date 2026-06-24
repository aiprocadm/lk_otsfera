# Spec: Пакет мелких пробелов ТЗ (gap #4)

**Дата:** 2026-06-24
**Источник:** ТЗ «Личный кабинет Промтехносфера» v0.4 — §7.1, §9.1, §11, §13
**Статус:** design (autonomous goal-run «заверши всё по ТЗ»); ассумпции помечены — ждут
review перед planning.
**Память:** [[project-tz-v04-gap-program-2026-06-23]] gap #4.

## 1. Проблема и контекст

Четыре независимых мелких пробела ТЗ, собранных в один «пакет» (один spec → один plan
→ один PR), т.к. каждый по отдельности слишком мал для полного цикла §8:

| # | ТЗ | Сейчас в коде | Целевое |
|---|----|--------------|---------|
| A | §11 лимит файла | 20 МБ хардкод в ~7 местах + env default 10 | 200 МБ, **единый источник** |
| B | §13 форматы | allow-list: pdf/jpg/png/docx/xls/xlsx | + `.doc` (msword); список — **ASSUMPTION** |
| C | §9.1 история ставок комиссии | только `Partner.commissionRate` (скаляр) + audit | first-class история с датами |
| D | §7.1 поля оплаты | `Payment`: amount/paidAt/method/note/externalId | + НДС + кто внёс (+ явные purpose/№ документа) |

Принцип gap-программы: **улучшаем логику, не переделываем**. Ни один из существующих
контрактов (Result-тип §3, scan/storage §10, commission-calc) не меняется.

## 2. Под-пункт A — лимит файла 200 МБ + единый источник (§11)

### 2.1. Проблема
Лимит «20 МБ» дублируется минимум в 7 местах с расхождениями (env default `10`, сервис
`20`, UI-лейблы `20`/`10`):
- [src/lib/services/documents/upload-core.ts:17](src/lib/services/documents/upload-core.ts) — `MAX_FILE_SIZE_BYTES = 20*1024*1024` + локальный `ALLOWED_MIME_TYPES`
- [src/app/api/documents/upload/route.ts:24](src/app/api/documents/upload/route.ts) — `DEFAULT_MAX_FILE_SIZE_MB = 10` + env-парс
- [src/components/partner/lead-attachment-dropzone.tsx:20](src/components/partner/lead-attachment-dropzone.tsx) — `maxSizeMb = 10`
- [src/components/organization/organization-document-upload-form.tsx:83](src/components/organization/organization-document-upload-form.tsx), `organization-order-less-upload-form.tsx:86` — лейбл «Максимум 20 МБ»
- [src/lib/errors/messages.ts:14](src/lib/errors/messages.ts) — `too_large: 'Файл превышает 20 МБ.'`

### 2.2. Решение — единый модуль `src/lib/config/upload.ts`
Client-safe (без `server-only`, без прямого чтения секретов), экспортирует:
```ts
export const DEFAULT_MAX_FILE_SIZE_MB = 200;          // §11
export function resolveMaxFileSizeMb(): number {       // server: env-override + валидация
  const raw = Number(process.env.DOCUMENT_MAX_FILE_SIZE_MB ?? DEFAULT_MAX_FILE_SIZE_MB);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_FILE_SIZE_MB;
}
export function maxFileSizeBytes(): number { return resolveMaxFileSizeMb() * 1024 * 1024; }
export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([...]); // см. §3
```
- `upload-core.ts` и `route.ts` — импортируют `maxFileSizeBytes()`/`ALLOWED_MIME_TYPES`,
  локальные константы удаляются. (route.ts сохраняет свой warn-фолбэк через тот же resolver.)
- Клиентские компоненты — лейблы и client-side pre-check используют `DEFAULT_MAX_FILE_SIZE_MB`
  (клиент не читает env; серверная валидация остаётся authoritative).
- `errorMessageRu.too_large` → «Файл превышает допустимый размер.» (без числа — снимаем drift).
- **Вне объёма:** `server-actions/import.ts` `MAX_BYTES = 20МБ` — это лимит **парса xlsx-выгрузки 1С**
  (внутренний операторский файл), не пользовательский документ §11. Остаётся 20 МБ, но
  переезжает на отдельную именованную константу `IMPORT_MAX_XLSX_BYTES` для ясности.
- `.env.example` / `README.md` / `CLAUDE.md §10` / `CHANGELOG` — обновить «20 МБ» → «200 МБ».

## 3. Под-пункт B — форматы (§13) **[ASSUMPTION]**

Точный список §13 в распоряжении агента отсутствует (ТЗ не в репозитории). Текущий
allow-list (PDF/JPG/PNG/DOCX/XLS/XLSX) сохраняется; добавляется единственный безопасный
кандидат — legacy `application/msword` (`.doc`), парный к уже разрешённому `.docx`.

`ALLOWED_MIME_TYPES` (единый, в `config/upload.ts`):
```
application/pdf, image/jpeg, image/png,
application/msword,                                            // .doc  (NEW)
application/vnd.openxmlformats-...wordprocessingml.document,   // .docx
application/vnd.ms-excel,                                      // .xls
application/vnd.openxmlformats-...spreadsheetml.sheet          // .xlsx
```
**Magic-byte нюанс:** `mimeValidator.SUPPORTED_MIME_TYPES` проверяет сигнатуры только для
5 типов; `.doc`/`.xls` (OLE2 CFBF) в нём нет, поэтому для них magic-byte-чек пропускается
(как уже сделано для `.xls` сегодня — он в allow-list, но не в SUPPORTED). Поведение
консистентно: allow-list — это «что принимаем», magic-bytes — «дополнительная защита где умеем».
**Open question для review:** подтвердить полный список §13; добавить недостающее — это
1 строка в `ALLOWED_MIME_TYPES` (+ опц. сигнатура в mimeValidator).

## 4. Под-пункт C — история ставок комиссии (§9.1)

### 4.1. Модель
```prisma
model CommissionRateChange {
  id            String   @id @default(cuid())
  createdAt     DateTime @default(now())
  partnerId     String
  partner       Partner  @relation(fields: [partnerId], references: [id], onDelete: Cascade)
  oldRate       Decimal? @db.Decimal(6, 4)   // null = первичная установка
  newRate       Decimal  @db.Decimal(6, 4)
  effectiveFrom DateTime @default(now())      // дата вступления (= момент изменения; §9.1 «с датами»)
  changedById   String?                       // кто изменил (audit-связка, nullable для системных)
  @@index([partnerId, effectiveFrom])
}
```
`Partner` получает relation `commissionRateChanges CommissionRateChange[]`.

### 4.2. Write-сайт (единственный)
`admin/partners.ts` — `updatePartner` и `createPartnerWithAdmin` (внутри их существующих
`$transaction`): если `commissionRate` фактически меняется (`before !== after`), добавить
строку `CommissionRateChange` тем же `tx`. Реюз уже читаемого `before.commissionRate`.
`createPartnerWithAdmin` с ненулевой стартовой ставкой → `oldRate=null`.

### 4.3. Read / UI
Сервис `listRateHistory(prisma, session, partnerId)` (admin-only, Result-тип) →
`{ rows: Array<{ oldRate, newRate, effectiveFrom, changedByName }> }`. Отрисовка — таблица
на странице `/admin/partners/[id]` под блоком ставки.

### 4.4. Намеренно НЕ трогаем
`commission/calculator.ts` продолжает брать `Partner.commissionRate` на момент расчёта.
История — **audit/display-only**; ретро-пересчёт по `effectiveFrom` НЕ вводится (риск
регрессии комиссий; CLAUDE.md помечает их чувствительными). Если ТЗ §9.1 требует
ретро-расчёт — это отдельный spec с миграцией расчётчика.

## 5. Под-пункт D — поля оплаты (§7.1)

### 5.1. Что уже есть
`Payment.note` маппится из колонки «Назначение платежа», `externalId` — из «Номер документа».
То есть «назначение» и «номер документа» де-факто присутствуют. Реально отсутствуют:
**НДС** и **кто внёс**.

### 5.2. Модель — добавить в `Payment`
```prisma
  vatAmount          Decimal?  @db.Decimal(14, 2)  // НДС (§7.1); null = не выделен
  purpose            String?                       // назначение (явное поле; дублирует семантику note)
  paymentOrderNumber String?                       // № платёжного поручения (§7.1)
  enteredById        String?                       // кто внёс
  enteredBy          User?     @relation("PaymentEnteredBy", fields: [enteredById], references: [id])
```
`User` получает back-relation `paymentsEntered Payment[] @relation("PaymentEnteredBy")`.
- `purpose`: новое явное поле; `note` остаётся для свободного комментария. Импорт пишет
  колонку «Назначение платежа» в **оба** (`purpose` + `note`) для обратной совместимости
  read-сайтов; новые read-сайты предпочитают `purpose`. (Альтернатива — переименовать
  `note→purpose` — отвергнута: ломает существующие read/UI/тесты, «не переделываем».)
- `paymentOrderNumber`: опциональная новая колонка импорта (может отсутствовать в выгрузке).

### 5.3. Write-сайт (единственный)
`oneCSync/writers.ts:93` `payment.create` — добавить новые поля из расширенного DTO.
- `enteredById`: для **файл-импорта** = актор-оператор (прокинуть через ctx, если доступно);
  для **live-1C** = null (системная запись). Не блокирует — поле nullable.
- DTO/schema/mappers (`oneCSync/schemas.ts`, `mappers.ts`) + `import/column-map.ts` — добавить
  опциональные поля `vatAmount`, `paymentOrderNumber` (purpose уже = note-колонка).
  `column-map.ts` SAMPLE-LOCKED → новые колонки опциональны, default null до сверки с выгрузкой.

### 5.4. Read / UI
Леджер платежей (`organization/finance.ts`, `manager/finance` sibling) — DTO расширяется
полями (НДС/назначение/№ поручения/кто внёс); таблица платежей показывает новые колонки.
Decimal сериализуется в строку на границе RSC (паттерн `DealRow`/`.toFixed(2)`).

## 6. Миграция

Одна миграция (`migrate diff` → `migrate deploy`, **не** `migrate dev` — см.
[[project-tz-v04-gap-program-2026-06-23]]): новая таблица `CommissionRateChange` +
4 nullable-колонки в `Payment` + FK `Payment.enteredById→User`. Все добавления
аддитивны и nullable → backward-safe, без data-backfill. Demo-seed может опц. засеять
1–2 строки истории ставок.

## 7. RBAC / безопасность

- История ставок (C) — **admin-only** (как вся `/admin/partners`); defense-in-depth: middleware
  `/admin` + page-гард + сервис-чек роли. Ставки комиссии = чувствительные (CLAUDE.md §13/§5).
- Поля оплаты (D) — видимость наследует существующий scope леджера платежей
  (org → свои, manager → `managedOrgIds`+`teamMode`, partner → свои, admin → все). Новые
  поля не расширяют видимость записей, только колонки внутри уже-видимой записи.
- Лимит/форматы (A/B) — серверная валидация в `upload-core` остаётся authoritative.

## 8. Тесты (§6)

- **Unit**: `config/upload.resolveMaxFileSizeMb` (env-override, фолбэк на невалид/0/NaN);
  `validateUploadFile` принимает `.doc`, отвергает запрещённый MIME и при превышении лимита;
  `admin/partners.updatePartner` пишет `CommissionRateChange` только при смене ставки (не при
  смене только name/isActive); `listRateHistory` deny для не-admin.
- **Integration** (живой PG): rate-history append через реальную транзакцию; payment с новыми
  полями через `writers.ts`; леджер отдаёт новые поля scoped.
- **Coverage**: новые logic-файлы под порогом 100% (§6 фаза 1) — `config/upload.ts`,
  rate-history сервис, расширения writers/mappers.
- **Guardrail**: `import.no-second-writer` остаётся зелёным (payment пишется только в writers).

## 9. Вне объёма (явно)

- Ретро-пересчёт комиссий по `effectiveFrom` (§9.1 — только если ТЗ требует; отдельный spec).
- Ручной UI-ввод платежа оператором (сейчас платежи только из 1С/импорта; `enteredBy`
  заполняется для импорта, для live-1C = null).
- Точный список форматов §13 (ASSUMPTION — подтвердить на review; добавление = 1 строка).
- Поднятие лимита парса xlsx-импорта (остаётся 20 МБ — это не пользовательский документ).

## 10. Критерии приёмки

1. Документ 21–200 МБ принимается; >200 МБ отклоняется (`too_large`); лимит читается из
   одного модуля (env-override работает, невалид → фолбэк 200).
2. `.doc` (msword) принимается наравне с `.docx`.
3. Смена ставки комиссии партнёра пишет строку истории с датой и автором; смена только
   имени/активности — не пишет. История видна admin на странице партнёра, не видна остальным.
4. Платёж хранит НДС / назначение / № поручения / кто внёс; поля видны в леджере в рамках
   существующего scope; платёж пишется по-прежнему только через `writers.ts`.
5. Все гейты зелёные (typecheck/lint/unit/integration); guardrail второго writer'а не падает.
