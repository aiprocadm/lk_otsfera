# ADR 0006: Admin-доступ — Model A («Зеркало»), без входа в чужие кабинеты

**Статус:** принято, 2026-06-07 (вычитка спеки role-consistency; Model B отклонён).

## Контекст

Принцип заказчика — «admin управляет всем». Рассматривались два способа: Model A —
собственное зеркало `/admin/*` с policy «admin видит всё»; Model B — impersonation
(литеральный вход admin в кабинеты ролей). Model B отклонён как избыточный.

## Решение

Admin работает **только через `/admin/*` зеркало** + `policy.ts` (`return true`).
`protectedPrefixes` пускает в кабинет только его роль (`/manager`→manager и т.д.);
admin в кабинетных префиксах не работает — page-гарды его отбивают. Исключение —
`/student` (намеренный shared-entry с серверным гейтом на выпуск токена).

## Последствия

- Не добавлять admin в кабинетные префиксы «чтобы посмотреть» — это мёртвая дверь.
- Новая функция кабинета, нужная админу, получает страницу-зеркало в `/admin/*`.

## Источники

- [Спека role-consistency-audit, ось 4](../superpowers/specs/2026-06-07-role-consistency-audit-design.md) · [CLAUDE.md §4](../../CLAUDE.md)
- [src/lib/auth/policy.ts](../../src/lib/auth/policy.ts) · [src/lib/auth/access.ts](../../src/lib/auth/access.ts) (`protectedPrefixes`)
