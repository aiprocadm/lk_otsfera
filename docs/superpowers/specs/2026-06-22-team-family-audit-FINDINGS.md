# Findings — семейство «Команда» (аудит 2026-06-22)

Методология наследуется (SP1). Префикс — `DT` (Track **D** / **T**eam). 4 роли: partner/org/manager/leader
(admin-экрана команды нет — Model A).

**Два разных домена под одним словом «Команда»:**
- **partner / organization** — управление участниками своей орг/партнёра (инвайты, роли, деактивация);
- **manager / leader** — ростер менеджеров компании + тумблер видимости команды (`managerTeamVisibility`).
manager-страница — redirect на `/leader/team` при `leader_cabinet` (legacy-совместимость). Это намеренное
доменное расхождение; выравнивать содержимое нельзя — только общий chrome (заголовок, форматтеры).

---

## Таблица «ось × роль»

| # | Ось | partner | organization | manager | leader | Severity | Канон |
|---|-----|---------|--------------|---------|--------|----------|-------|
| 1 | Заголовок | «Команда» `text-2xl font-**bold** text-[#111111]` | то же | «Команда» `font-semibold text-[#111111]` ✅ | то же ✅ | **P2** | `font-semibold text-[#111111]` (partner/org → semibold) |
| 2 | Auth-guard | `requirePartnerAdmin()` | `getOrgPageContext` + `viewerRole` гард | `requireManagerLeader()` | `requireManagerLeader()` | OK | канонические хелперы у всех |
| 3 | pluralize | локальный `pluralize` | **два** локальных (`pluralizeMembers`+`pluralizeAdmins`) | n/a | n/a | P3 | `pluralizeRu` |
| 4 | fmtDate | (в `partner/team-table` — нет локального) | **локальный `fmtDate`** в `org/team-table` (без TZ) | n/a | n/a | P3 | `fmtDate` из `@/lib/format` (TZ Europe/Moscow) |
| 5 | Мобайл (таблица) | `TeamTable` `hidden md:block` + `TeamCardList` `md:hidden` (полное покрытие) | `TeamTable` всегда видна, `TableShell overflow-hidden` (на узком экране клип) | roster-panel | roster-panel | P3 | разные паттерны; org-клип — judgment владельца |
| 6 | Действия | инвайт + роль/деактивация | инвайт + роль/деактивация | тумблер видимости | тумблер видимости | INTENTIONAL | разные домены |

---

## Подтверждённые находки (чиним — канон R1/F2)

### DT1 — Заголовки: partner/org `font-bold` vs manager/leader `font-semibold` — P2
manager/leader уже на каноне (`font-semibold text-[#111111]`); partner/org — `font-bold`. → partner/org
`font-bold`→`font-semibold`. → чиним.

### DT2 — Локальные плюрализаторы — P3
partner `pluralize`; org **два** (`pluralizeMembers`, `pluralizeAdmins`). → `pluralizeRu` из `@/lib/format`.
→ чиним.

### DT3 — Локальный `fmtDate` в `org/team-table` (без TZ) — P3
DF2-паттерн: `new Intl.DateTimeFormat('ru-RU', …)` без `Europe/Moscow`. → `fmtDate` из `@/lib/format`. → чиним.

---

## Открытые решения для владельца (НЕ реализуем)

1. **DT-mobile (ось 5):** partner использует `hidden md:block` table + `md:hidden` card-list (полное мобайл-
   покрытие); org рисует `TeamTable` всегда с `TableShell` (дефолт `overflow-hidden`) → на узком экране
   правые колонки (Действия) клипаются без скролла. Вариант: `overflow='x-auto'` (скролл) или
   `OrgTeamCardList` (sibling, как partner). Решение владельца (затронет вид/снапшоты).
2. **Паттерн table-vs-card** между partner (card) и org (table-only) — оставить расхождение или унифицировать?

## Файлы аудита
Страницы `src/app/{partner,organization,manager,leader}/team/page.tsx`; компоненты `partner/team-{table,card-list}.tsx`,
`organization/team-table.tsx`, `manager/{team-visibility-toggle,manager-roster-panel}.tsx`;
сервисы `{partner,organization,manager}/team*.ts`; `lib/format.ts`.
