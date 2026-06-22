# Close-out — аудит + ремедиация семейства «Документы» (Track D, SP3)

План — `2026-06-22-documents-family-audit.md`. Здесь — что отгружено.

## Отгружено

**Аудит** (`docs/superpowers/specs/2026-06-22-documents-family-audit-FINDINGS.md`): 4 роли (partner/org/
manager/admin; у leader отдельного экрана документов нет) × 7 осей, находки DD1–DD4 + открытые решения.
Ключевое наблюдение: `DocumentsList` уже общий для всех 4 ролей — дублируется только page-chrome.

**Ремедиация** (продолжение канона Заказов R1/F2 + §13 локализация):
- **DD1** заголовки: partner/org `font-bold`→`font-semibold`; **admin «Admin · Documents» `text-xl`
  (английский) → русское «Документы» `text-2xl font-semibold text-[#111111]`** (обе вкладки) — нарушение
  §13 (локализация UI = русский) + размер/цвет не по канону.
- **DD2** param поиска: manager `q`→`search` (Zod-схема `listDocuments` + фильтр + URL-param + форма +
  next/ordersTab href) + 2 теста (integration `q:'INVOICE'`, unit `q:'договор'`). Теперь все роли с поиском
  используют `?search=` (R1-канон).
- **DD3** пагинация: partner/org локальные `Paginator` (≈37 строк каждый) → общий `ui/Paginator`
  (извлечён в F2 Заказов; `basePath`+`searchParams`, сам считает страницы, null при ≤1 → guard убран).
- **DD4** `pluralize` локальный → `pluralizeRu` из `@/lib/format`.

Нетто: −~80 строк дублей; cursor/offset раскол НЕ трогали (spec §6).

## Верификация

typecheck ✅ · lint ✅ (0 warnings) · test:unit **277 файлов / 3032 теста** ✅ (3 skipped) · build ✅.
e2e:visual — operator-deferred (заголовки финэкранов изменятся — обновить baseline при визпрогоне).

## Не делалось (ждёт ратификации владельца)

DD-tabs (дедуп `TabChips` manager+admin + единый стиль: partner/org border-чипы инлайн vs manager/admin
`bg-gray-100`), DD-typefilter (общий `TypeFilter`/`Chip` для partner/org; manager `<select>` намеренно иной),
manager-подзаголовок, admin-пагинация general-вкладки (`take:200` без пагинатора).

## Остаток Track D

Семейства **Сообщения / Команда / Заявки на обучение** — отдельные подпроекты (SP4+).
