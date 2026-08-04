# ADR 0007: Менеджерский scope mode-aware (C8) — граница видимости переключаемая

**Статус:** принято, 2026-06-05 (спека C8 согласована заказчиком; default OFF).

## Контекст

Изначально менеджер видел только «свои» заказы (3-way: per-order managerId, назначение
на организацию, исторические комментарии). Заказчику нужен режим «команда видит всё»
без потери изоляции между компаниями.

## Решение

Флаг `Company.managerTeamVisibility` (default OFF, флип в рантайме leader/admin):
ON → граница видимости — **компания** (`{ companyId: session.companyId }`);
OFF → прежний 3-way per-manager. Инвариант в обоих режимах: менеджер **никогда**
не видит чужую компанию (`companyId=null` → deny-all). Флаг читается свежим и
передаётся как `teamMode` в резолверы/`canSeeOrder`; пропуск аргумента = молча scoped.
Notification-таргетинг намеренно остаётся scoped (видимость ≠ рассылка).

## Последствия

- Все manager read/guard-сайты обязаны прокидывать `teamMode` (typecheck это не ловит).
- Cross-company изоляция закреплена интеграционным инвариант-тестом.

## Источники

- [Спека C8](../superpowers/specs/2026-06-05-c8-manager-company-wide-design.md) · [CLAUDE.md §4](../../CLAUDE.md)
- [managerPolicy.ts](../../src/lib/auth/managerPolicy.ts) · [invariants.company-isolation.integration.test.ts](../../src/__tests__/invariants.company-isolation.integration.test.ts)
