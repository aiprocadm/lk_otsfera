# Этап 4 «Партнёр перестаёт быть обязательным» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** организация без партнёра создаётся как прямой клиент; партнёр ищется
по ИНН (с прежним `slug` как запасным путём); код `no_partner_external_id`
исчезает.

**Спека:** [2026-08-05-stage4-1c-partner-optional-design.md](../specs/2026-08-05-stage4-1c-partner-optional-design.md) — подтверждена (влита PR #316).
**ТЗ:** Т-19, Т-19а, Т-20. Ветка `stage4-1c-partner-impl`, PR отдельный.

## Global Constraints

- Объём — строго Т-19/Т-19а/Т-20. `pullOrganizations`, синтетический ключ,
  валидация ИНН — этап 5; `tx.company.create` — этап 6.
- Ветка update существующей организации партнёра НЕ трогает.
- Схема БД не меняется; миграций нет.
- CHANGELOG обязан упомянуть влияние на сетевую синхронизацию (сноска Т-19).
- Покрытие изменённых файлов 100%; integration локально до пуша.

---

### Задача 1: `normalizeInn` (минимум этапа 4)

Создать `src/lib/services/oneCSync/inn.ts`: убрать все пробельные символы
(включая неразрывные). Комментарий: этап 5 (Т-22) расширит эту же функцию
(число→строка, ведущие нули) — единственная точка правды, как требует Т-20.
Тест `oneCSync.inn.unit.test.ts`.

### Задача 2: ветка партнёра в `upsertOrgRecord` (Т-19 + Т-20)

`writers.ts`: вместо «нет партнёра → skip»:
- `partnerExternalId` пуст → `partnerId = null`, организация создаётся;
- указан → `findFirst({ where: { OR: [{ inn: normalizeInn(raw) }, { slug: raw }] } })`;
  не найден → `skip: partner_not_found`; найден → привязка.
Код `no_partner_external_id` удаляется. Комментарий-обоснование OR (сетевой
adapter-rest шлёт slug).

### Задача 3: тесты

- `oneCSync.writers.test.ts`: моки `partner.findUnique` → `partner.findFirst`;
  тест `no_partner_external_id` заменяется на «null-партнёр → создаётся прямой
  клиент, партнёрский поиск не вызывается»; новый тест формы OR-запроса;
  «не найден → partner_not_found» остаётся.
- Проверить соседей: `worker.sync-organizations.shadow.test.ts`,
  `security.import-org-doc-scope.test.ts` (моки партнёра).
- Integration (живой Postgres) `import.stage4-partner.integration.test.ts`:
  Т-19 (прямой клиент, `partnerId: null`), Т-19а (две организации на один ИНН
  партнёра), несуществующий партнёр → skip, идемпотентность повторного прогона.

### Задача 4: гейты и документация

typecheck, lint, prettier, покрытие 100%, integration локально, полный
test:unit; CHANGELOG (отдельный абзац про сетевую синхронизацию), STATUS
(этап 4 → 🔍 PR), close-out, PR с `base: main`.
