# Findings — семейство «Заявки на обучение» (аудит 2026-06-22)

Методология наследуется (SP1). Префикс — `DE` (Track **D** / **E**nrollments). 5 ролей: partner/org/manager/
leader/admin. Финальное семейство Track D.

**Самое консистентное семейство из всех шести.** Все 5 страниц: единый флаг `enrollment_requests`
(`notFound` во всех 5 — идеально), канонические `require*`-хелперы, `space-y-5`, общий заголовок-текст,
общие компоненты `components/enrollment/*` (без локальных форматтеров). Единственная находка — дрейф
font-weight на одной странице.

---

## Таблица «ось × роль»

| # | Ось | partner | organization | manager | leader | admin | Severity | Канон |
|---|-----|---------|--------------|---------|--------|-------|----------|-------|
| 1 | Заголовок | `font-semibold text-[#111111]` ✅ | **`font-bold`** ⚠️ | `font-semibold` ✅ | `font-semibold` ✅ | `font-semibold` ✅ | **P2** | `font-semibold text-[#111111]` (org → semibold) |
| 2 | Флаг-гейт | `enrollment_requests` notFound | то же | то же | то же | то же | OK ✅ | единый — эталон гейтинга |
| 3 | Auth-guard | `requirePartner()` | `getOrgPageContext` | `requireManager()` | `requireManagerLeader()` | `requireAdmin()` | OK ✅ | канонические хелперы |
| 4 | Вид списка | `EnrollmentList` (submitter) | `EnrollmentList` (submitter) | `EnrollmentQueue` (processor) | `EnrollmentQueue` | `EnrollmentQueue` | INTENTIONAL | submitter видит свои; processor обрабатывает |
| 5 | Форма подачи | есть | есть | есть | **нет** (leader только обрабатывает) | есть | INTENTIONAL | leader = чистый processor |
| 6 | Контейнер | `space-y-5` | `space-y-5` | `space-y-5` | `space-y-5` | `space-y-5` | OK ✅ | единый |

---

## Подтверждённая находка (чиним — канон R1)

### DE1 — org-заголовок `font-bold` vs `font-semibold` у остальных 4 — P2
Единственное расхождение в семействе: `organization/enrollments` использует `font-bold`, четыре другие
роли — `font-semibold text-[#111111]`. → org `font-bold`→`font-semibold`. → чиним.

---

## Намеренные различия (НЕ трогаем)

submitter (`EnrollmentList`) vs processor (`EnrollmentQueue`) вид (ось 4); отсутствие формы подачи у leader
(ось 5) — это доменные роли submitter/processor, не баг.

## Открытых решений для владельца — нет.

## Файлы аудита
Страницы `src/app/{partner,organization,manager,leader,admin}/enrollments/page.tsx`; общие компоненты
`components/enrollment/{enrollment-list,enrollment-queue,enrollment-request-form,enrollment-status-badge}.tsx`;
сервис `lib/services/enrollments/list.ts`.
