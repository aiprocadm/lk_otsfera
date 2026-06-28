# План — аудит семейства «Сообщения» (Track D, SP4)

FINDINGS: `docs/superpowers/specs/2026-06-22-messages-family-audit-FINDINGS.md`.

## Задачи
- [x] A1 — FINDINGS (4 роли; матрица §5 = намеренные различия; DM1/DM2 + INTENTIONAL).
- [x] DM1 — заголовки канон `text-2xl font-semibold text-[#111111]` (partner/org font-bold→semibold; manager/admin +text-color).
- [x] DM2 — `organization/messages` → `requireOrganization()` (с сырого getSession+redirect).
- [ ] Гейты: typecheck ✅ · lint ✅ · test:unit (в процессе) · build.
- [ ] Close-out (-DONE.md).

## §5 — НЕ трогаем
Гейтинг `chat` (notFound vs graceful vs ungated-comments), `variant role/team`, условный UnreadBadge —
намеренная матрица CLAUDE.md §5. Открытых решений владельцу нет.
