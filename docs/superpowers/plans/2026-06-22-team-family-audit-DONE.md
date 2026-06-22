# Close-out — аудит семейства «Команда» (Track D, SP5)

FINDINGS: `docs/superpowers/specs/2026-06-22-team-family-audit-FINDINGS.md`.

## Контекст
«Команда» — два разных домена: partner/org = управление участниками (инвайт/роль/деактивация);
manager/leader = ростер менеджеров компании + тумблер видимости. manager → redirect на `/leader/team`
при `leader_cabinet`. Содержимое НЕ выравнивается (намеренно), только chrome.

## Отгружено
- **DT1** заголовки: partner/org `font-bold`→`font-semibold` (manager/leader уже на каноне
  `font-semibold text-[#111111]`).
- **DT2** плюрализаторы: partner `pluralize` + org `pluralizeMembers`/`pluralizeAdmins` (три локальных) →
  `pluralizeRu` из `@/lib/format`.
- **DT3** `org/team-table` локальный `fmtDate` (без TZ) → `fmtDate` из `@/lib/format` (Europe/Moscow).

## Верификация
typecheck ✅ · lint ✅ · test:unit (прогон) · build (после unit). e2e:visual operator-deferred.

## Вынесено владельцу
DT-mobile: org `TeamTable` (`TableShell` дефолт `overflow-hidden`) клипает на узком экране, тогда как partner
имеет `hidden md:block` table + `md:hidden` card-list. Унифицировать (`overflow='x-auto'` или `OrgTeamCardList`)
или принять — решение владельца (затронет вид/снапшоты).

## Остаток Track D
Семейство **Заявки на обучение** — последний подпроект (SP6).
