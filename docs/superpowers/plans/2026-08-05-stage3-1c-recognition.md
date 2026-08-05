# Этап 3 «Устойчивое распознавание файла» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** импорт узнаёт листы и колонки, даже если они названы чуть иначе;
принимает `.xls`; определяет формат по содержимому; вместо «Файл пуст» отвечает,
что именно не распозналось.

**Спека:** [2026-08-05-stage3-1c-recognition-design.md](../specs/2026-08-05-stage3-1c-recognition-design.md) — подтверждена (влита PR #314).
**ТЗ:** Т-8…Т-14. Ветка `stage3-1c-recognition-impl`, PR отдельный (спека уже в main).

**Принятое допущение (вопрос §8 спеки):** файл с «неправильным» расширением
читается по содержимому; `format_mismatch` — только когда содержимое вообще не
Excel. Заказчик влил спеку с этой рекомендацией; явного возражения нет —
отмечено в PR.

## Global Constraints

- Объём — строго Т-8…Т-14; точные названия из выгрузки заказчика — отдельным
  маленьким PR того же этапа, когда придёт файл.
- Модуль банковской выписки (`oneCAccountCard/*`) **не трогаем**.
- Значения ячеек для `.xlsx`-пути не меняются (ExcelJS остаётся) — существующие
  тесты разбора служат страховкой от регресса сумм и дат.
- Схема БД, права — без изменений; миграций нет.
- Покрытие изменённых файлов 100%; integration локально перед пушем
  (грабля этапа 2: unit не видит integration-фикстур с зашитыми числами).

---

### Задача 1: `normalize.ts` — нормализация ярлыка (Т-8)

Создать `src/lib/services/import/normalize.ts`:
`normalizeLabel()`: ` `/переносы/табы → пробел → trim → схлопнуть пробелы →
lowercase → `ё`→`е`. Тест `import.normalize.unit.test.ts`: все пять классов
искажений из ТЗ П-7.

### Задача 2: `workbook.ts` — загрузчик книги по сигнатуре (Т-13, Т-14)

Создать `src/lib/services/import/workbook.ts`:
- `sniffWorkbookFormat(buf): 'xlsx' | 'xls' | null` (`PK` / `D0 CF 11 E0`);
- `class WorkbookFormatError extends Error`;
- `loadWorkbookSheets(buffer): Promise<SheetGrid[]>` где
  `SheetGrid = { name: string; rows: unknown[][] }` (`rows[0]` — шапка):
  xlsx → ExcelJS (значения ячеек как раньше), xls → SheetJS
  (`{header:1, defval:null, raw:true, cellDates:true}` — числа числами, даты
  Date, как отдаёт и ExcelJS), не Excel → `WorkbookFormatError`.

Тест: xlsx-книга и xls-книга дают одинаковую форму; мусор → бросок.

### Задача 3: `column-map.ts` — алиасы (Т-9) + `REQUIRED_COLS`

Строки → массивы алиасов (первый — основной, точный раньше общего); стартовый
набор — из вариантов, которые называет само ТЗ (П-7). Добавить
`REQUIRED_COLS = { orgs: ['inn'], orders: ['externalId','orgInn'], payments: ['externalId','orgInn','amount','paidAt'] }`.
Обновить `import.column-map.test.ts` под массивы.

### Задача 4: `diagnostics.ts` — нормализация + новые поля

`unmatchedHeadersOf(headers, cols)` сравнивает нормализованно (cols — массивы).
`ImportDiagnostics` += `missingColumns: Record<string, string[]>` (лист →
основные ярлыки недостающих обязательных колонок), `duplicateSheets:
Record<string, string[]>` (вид → лишние совпавшие листы), `formatNote?: string`.
Обновить тест этапа 1 (там точное сравнение зафиксировано «до этапа 3» — переход
наступил).

### Задача 5: `parse-workbook.ts` поверх загрузчика (Т-9, Т-10)

Лист ищется по вхождению нормализованных имён в обе стороны; первый в порядке
книги — победитель, остальные в `duplicateSheets`. Колонка — первый совпавший
алиас. `missingColumns` — по `REQUIRED_COLS` для найденных листов. Значения
строк — как раньше (`v ?? null`). Обновить/дополнить тесты parse-workbook
(«чужие имена листов» теперь должны быть НАСТОЯЩЕ чужими — «Лист1»).

### Задача 6: `import/index.ts` — новые коды (Т-11, Т-12, Т-14)

`Err` += `sheets_not_recognized | columns_not_recognized | format_mismatch`.
`Args` += `fileName?: string` → `formatNote` в диагностике при расхождении
имени и содержимого. В preview и commit после разбора:
ни одного распознанного листа → `sheets_not_recognized` (+diagnostics);
есть `missingColumns` → `columns_not_recognized` (+diagnostics);
`WorkbookFormatError` → `format_mismatch` (без диагностики).
Порядок: format → sheets → columns → empty. Тесты.

### Задача 7: серверное действие + формы + тексты

`server-actions/import.ts`: принять `.xls`, передать `fileName`.
`error-messages.ts`: +3 кода (обе карты), `invalid_file` xlsx-формы теперь
«.xls или .xlsx». `import-form.tsx`: `accept=".xls,.xlsx"`, метка, в панели
диагностики — недостающие колонки, дубли листов, `formatNote`. Тесты форм и
словаря (тест «подсказки разные» — переписать: формы сравнялись по форматам).

### Задача 8: скрипт-инспектор

Перевести на `loadWorkbookSheets` + алиасы + нормализацию: читает `.xls`,
показывает то же сопоставление, что и боевой разбор. Ручной прогон на
«правильной» и «кривой» книгах + на `.xls`.

### Задача 9: гейты и документация

`typecheck`, `lint`, `prettier`, адресное покрытие 100%, полный `test:unit`,
**integration локально** (`import.unified.integration`, `cov.import-commit` +
полный `test:integration` при времени), CHANGELOG, STATUS (этап 3 → 🔍 PR),
close-out, PR с `base: main`.
