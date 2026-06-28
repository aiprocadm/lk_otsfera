# План — аудит семейства «Команда» (Track D, SP5)

FINDINGS: `docs/superpowers/specs/2026-06-22-team-family-audit-FINDINGS.md`.

## Задачи
- [x] A1 — FINDINGS (4 роли; partner/org=member-mgmt, manager/leader=roster+toggle — намеренно разные домены).
- [x] DT1 — partner/org заголовки `font-bold`→`font-semibold` (manager/leader уже канон).
- [x] DT2 — partner `pluralize` + org `pluralizeMembers`/`pluralizeAdmins` → `pluralizeRu`.
- [x] DT3 — org `team-table` локальный `fmtDate` → `@/lib/format` (TZ-fix).
- [ ] Гейты: typecheck ✅ · lint ✅ · test:unit (в процессе) · build.
- [ ] Close-out (-DONE.md).

## Открытые решения владельцу
DT-mobile (org `TeamTable` `overflow-hidden` клип vs partner card-list); table-vs-card паттерн. См. FINDINGS.
