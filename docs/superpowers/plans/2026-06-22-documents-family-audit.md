# План — аудит + ремедиация семейства «Документы» (Track D, SP3)

FINDINGS: `docs/superpowers/specs/2026-06-22-documents-family-audit-FINDINGS.md`. Скоуп как SP1/SP2:
аудит + ремедиация ратификационно-безопасного подмножества (канон R1/F2 + §13); judgment-call — владельцу.

## Задачи

- [x] **A1 — FINDINGS** (4 роли × 7 осей, DD1–DD4 + открытые решения).
- [x] **DD1 — заголовки**: partner/org `font-bold`→`font-semibold`; **admin «Admin · Documents» `text-xl`
  (англ.) → рус. «Документы» `text-2xl font-semibold text-[#111111]`** (обе вкладки); канон R1 + §13 локализация.
- [x] **DD2 — param поиска**: manager `q`→`search` (сервис Zod-схема `listDocuments` + фильтр + URL-param +
  форма + nextParams/ordersTabHref) + integration-тест (`q:'INVOICE'`→`search`) + unit-тест (`q:'договор'`→`search`).
- [x] **DD3 — Paginator**: partner/org локальные `Paginator` → общий `ui/Paginator` (`basePath`+`searchParams`,
  сам считает страницы, null при ≤1 → guard `pages>1` удалён); удалены неиспользуемые `page`/`pages`.
- [x] **DD4 — pluralize**: partner/org локальный `pluralize` → `pluralizeRu` из `@/lib/format`.
- [ ] **Гейты**: typecheck ✅ · lint ✅ · test:unit (в процессе) · build (после unit).
- [ ] **Close-out** `-DONE.md`.

## Открытые решения для владельца (НЕ реализуем)

DD-tabs (дедуп `TabChips` manager+admin + единый стиль border-vs-gray), DD-typefilter (общий `TypeFilter`/
`Chip` для partner/org), manager-подзаголовок, admin-пагинация general-вкладки. См. FINDINGS §«Открытые решения».
