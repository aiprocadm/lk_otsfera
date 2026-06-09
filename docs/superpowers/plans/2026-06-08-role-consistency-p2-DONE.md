# Role Consistency — P2 (флаг messages + канонизация partner-гарда) — CLOSE-OUT

**Дата отгрузки:** 2026-06-08
**Ветка:** `claude/role-consistency-p2`
**План:** [2026-06-08-role-consistency-p2.md](2026-06-08-role-consistency-p2.md)
**Spec:** [role-consistency-audit](../specs/2026-06-07-role-consistency-audit-design.md) §3 (оси 3/5), §6 (строки 4/5)
**PR:** [#102](https://github.com/aiprocadm/lk_otsfera/pull/102) — merged 2026-06-08 (`d06266a`). Преемник P1 ([#100](https://github.com/aiprocadm/lk_otsfera/pull/100)).
**Статус:** ✅ полностью отгружено (2 оси + верификация).

> Ретро-составлен 2026-06-09: при отгрузке P2 close-out не завели (план тоже остался незакоммиченным untracked-файлом). Восстановлено для doc-консистентности с P1/P3.

---

## Что отгружено

### Ось 5 — флаг messages (DOC-ONLY)

Расследование показало, что буквальная рекомендация спеки («выровнять manager/partner/org `/messages` под единый флаг `chat`») вызвала бы **регрессию**: страница `/messages` несёт ДВА разных домена — order-comments (ungated, у manager/admin) и team-chat (флаг `chat`). У partner/org это чат-only (корректно hard-gated `chat` во всех 3 точках §5); менеджерский гейтить через `chat` нельзя — скрыло бы комментарии к заказам.

- Внесён `chat` в [CLAUDE.md](../../../CLAUDE.md) §5 (opt-in список) + **матрица гейтинга «Сообщения»** — фиксирует, почему единый флаг невозможен (защита от будущего «выравнивания»).
- Поправлен вердикт оси 5 в spec на doc-only.
- **Кода флагов не тронуто** — `chat` уже был enforced во всех 3 точках для чатовых поверхностей.

### Ось 3 — канонизация идиомы гарда (refactor)

- Новый `requirePartner()` + narrowed-тип `PartnerSession = SessionPayload & { partnerId: string }` в `requireRole.ts`; `requirePartnerAdmin()` тоже отдаёт `PartnerSession`.
- **14 partner-страниц** переведены с ручного `getSession()+redirect('/login')` на `require*` (12 → `requirePartner`, 2 admin-only → `requirePartnerAdmin`).
- Контракт усилен: отказ по роли → `/forbidden` (как под-роли в P1), не `/login`. Чистое сокращение кода (−57/+31 в страницах).

## Defense-in-depth §4

Не ослаблено. Ось 3 меняет только идиому page-гарда; тройная защита цела (middleware + page-`require*` + service-scope). Field-level `isPartnerAdmin` сохранён. Ось 5 — чисто документация.

## Верификация

- `npm run typecheck` · `npm run lint` — чисто
- `npm run test:unit` — **1245/1245** (157 файлов), incl. 6 новых тестов `requirePartner`
- grep-инвариант: **0** partner-страниц на ручном `getSession`
- Финальное холистическое ревью (opus) — **APPROVED** (field-level `isPartnerAdmin` сохранён, семантика гарда усилена, матрица docs соответствует коду)
- L2.5/L3 integration gate — не требуется (prisma/worker/services не тронуты)

## Остаток аудита (на момент P2)

Код-бэклог аудита: P1 ([#100](https://github.com/aiprocadm/lk_otsfera/pull/100)) merged, P2 (этот) merged, P3 ([#103](https://github.com/aiprocadm/lk_otsfera/pull/103)) следом. Подробности матрицы флага «Сообщения» закреплены в CLAUDE.md §5 (источник правды).
