# Этап 5 «Импорт организаций» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** `pullOrganizations()` перестаёт возвращать `[]` — организации из листа
«Контрагенты» создаются с синтетическим ключом `1c-inn:<ИНН>`; порядок батчей
orgs → orders → payments; ИНН валидируется и нормализуется; предпросмотр
перестаёт писать в базу.

**Спека:** [2026-08-05-stage5-1c-org-import-design.md](../specs/2026-08-05-stage5-1c-org-import-design.md) — подтверждена заказчиком 05.08.2026 («ок»).
**ТЗ:** Т-15…Т-18, Т-21…Т-24. Ветка `stage5-1c-org-impl`, PR отдельный.

## Global Constraints

- Сетевой путь (`OneCOrgSchema`, writer) поведения не меняет — валидация ИНН
  только в файловой схеме.
- Ветка создания в writer'е по-прежнему минтит `Company` — этап 6, не трогать.
- Схема БД не меняется; миграций нет.
- Покрытие изменённых файлов 100%; integration локально до пуша; после правки
  адаптера грепать его моки по `src/__tests__` (грабли этапов 2–4).

---

### Задача 1: `inn.ts` — нормализация с нулями, контрольная сумма, синтетический ключ

`normalizeInn`: + только-цифры длиной <10 → до 10 нулями, длиной 11 → до 12
(Т-22). `isValidInn`: 10/12 цифр + контрольные суммы (Т-21).
`synthOrgExternalId(inn) = '1c-inn:' + normalizeInn(inn)` (Т-16).
Тесты: `oneCSync.inn.unit.test.ts` (дополнить) — валидные 7707083893 /
500100732259, битые, паддинг, стабильность ключа.

### Задача 2: `OneCOrgFileSchema` (Т-21 через готовый канал ошибок)

`schemas.ts`: `OneCOrgSchema.superRefine` — нет `inn` → issue `no_inn`, битый →
`bad_inn`. Сетевая схема не тронута. Тест `oneCSync.schemas.org-file.unit.test.ts`.

### Задача 3: `pullOrganizations` (Т-15, Т-16) + колонка КПП

`column-map.ts`: `ORG_COLS.kpp: ['КПП']`. `adapter-file.ts`: маппинг строки →
DTO; `inn` нормализуется; валидный ИНН → `externalId = synthOrgExternalId`;
без/с битым ИНН → `externalId = наименование` (для колонки идентификатора в
таблице ошибок; файловая схема такую строку до writer'а не пустит); пустые
строки без наименования пропускаются. Обновить `oneCSync.adapter-file.test.ts`
(тест «orgs never created from Excel» умирает — это и была П-1).

### Задача 4: `resolveOrganizationRef` перестаёт писать в shadow (Т-24)

Обязательный третий параметр `canWrite: boolean`; writers передают
`isLive(ctx)` (2 места). Обновить `oneCSync.resolve-org.test.ts` + прочие моки.

### Задача 5: сервис и форма (Т-17, Т-18)

`import/index.ts`: батч организаций ПЕРВЫМ (`OneCOrgFileSchema` +
`upsertOrgRecord`), `ImportReport.orgs`, «пусто» считает все три.
`import-form.tsx`: карточка «Организации» в предпросмотре и итоге, локальный
тип. Обновить `import.index.unit` (кол-во вызовов батча 2→3, форма отчёта),
`import.contract` (последовательности mockResolvedValueOnce, toEqual отчёта),
`components.import-form*`.

### Задача 6: integration на живом Postgres (критерии приёмки 1, 2, 7, 11)

`import.stage5-org-import.integration.test.ts`: книга собирается ExcelJS в
тесте (3 листа), ИНН генерируются с валидной контрольной суммой от STAMP:
- полный файл в чистое состояние → организации созданы, заказ и оплата того же
  файла привязались (критерий 1);
- повтор → `создано 0, обновлено N` (Т-23, критерий 2);
- shadow: счётчики таблиц до/после совпадают, включая backfill (Т-24, критерий 7);
- строка без ИНН → invalid `no_inn` с наименованием, батч жив (критерий 11).
Уборка: payments → orders → организации → минтованные Company (как в этапе 4).

### Задача 7: гейты и документация

typecheck, lint, prettier (не забыть последние файлы!), покрытие 100%,
integration локально, полный test:unit; CHANGELOG, STATUS (этап 5 → 🔍 PR),
close-out, PR с `base: main`.
