# Findings — семейство «Сообщения» (аудит 2026-06-22)

Методология наследуется (SP1). Префикс — `DM` (Track **D** / **M**essages). 4 роли: partner/org/manager/admin.
Контекст домена — **матрица гейтинга `chat` (CLAUDE.md §5)**: различия в гейтинге между ролями **намеренные**,
их НЕ выравнивать.

`OrderThreadInbox` (`components/chat/order-thread-inbox.tsx`) — **уже общий** для всех 4 ролей (Tier-2
слияние partner/org/team инбоксов); различия ролей сведены к prop `variant: 'role'|'team'`. Empty-state
«Нет переписок» унифицирован. Дублирования chrome почти нет — отсюда находок мало.

---

## Таблица «ось × роль»

| # | Ось | partner | organization | manager | admin | Severity | Канон |
|---|-----|---------|--------------|---------|-------|----------|-------|
| 1 | Заголовок | «Сообщения» `text-2xl font-**bold** text-[#111111]`, `<div space-y-4>` | то же | «Сообщения» `font-semibold` **без `text-[#111111]`**, фрагмент `mb-4` | то же что manager | **P2** | `text-2xl font-semibold text-[#111111]` везде |
| 2 | Auth-guard | `requirePartner()` | **сырой `getSession()` + ручные `redirect('/login')`/`redirect('/forbidden')`** | `requireManager()` | `requireAdmin()` | **P2** | канонический `requireOrganization()` (Role-consistency ось3) |
| 3 | Гейтинг `chat` | `notFound()` если выкл (chat-only) | `notFound()` если выкл | НЕ notFound — order-comments ungated + chat-секция при `chatEnabled` | НЕ notFound — graceful «Чат не включён» | INTENTIONAL (§5) | НЕ выравнивать — матрица §5 |
| 4 | `OrderThreadInbox variant` | `role` | `role` | `team` (side-бейджи) | `team` | INTENTIONAL | по домену (role=своя сторона, team=обе) |
| 5 | UnreadBadge | всегда (chat=вся страница) | всегда | `chatEnabled &&` | `chatEnabled &&` | INTENTIONAL | привязан к наличию chat |
| 6 | Состояния/действия (инбокс) | общий `OrderThreadInbox` | общий | общий + секция «Комментарии к заказам» (`ManagerMessagesInbox`) | общий | INTENTIONAL | manager-комментарии — до-chat домен (§5) |

---

## Подтверждённые находки (чиним — продолжение канона R1 + Role-consistency ось3)

### DM1 — Заголовки расходятся — P2
partner/org `font-bold text-[#111111]`; manager/admin `font-semibold` **без** `text-[#111111]`. Канон R1:
`text-2xl font-semibold text-[#111111]` во всех 4. (Обёртку manager/admin — фрагмент с `mb-4` + секции `mt-8`
— НЕ переоформляем в `space-y-4`: их многосекционная раскладка использует явные отступы.) → чиним (только h1).

### DM2 — org-страница на сыром `getSession()` вместо канонического хелпера — P2
`organization/messages/page.tsx` — **единственная** страница с ручным `getSession()` +
`redirect('/login')`/`redirect('/forbidden')` (подтверждено grep `session.role !== 'organization'`).
Канон (Role-consistency ось3, как партнёр) — `requireOrganization()`. Он **строже** (требует активное
членство, не только роль) и совпадает с прочими org-страницами. → чиним.

---

## Намеренные различия (НЕ трогаем — §5)

Гейтинг `chat` (DM3): partner/org `notFound`, manager order-comments-ungated + chat-секция, admin graceful —
это матрица §5, выравнивание одним флагом регрессирует manager order-comments. `variant role/team` (DM4) и
условный UnreadBadge (DM5) — следствие домена. Секция «Комментарии к заказам» у manager (DM6) — до-`chat`
домен, ungated намеренно.

## Открытых решений для владельца — нет
Все различия либо чинятся по ратифицированному канону (DM1/DM2), либо намеренны по §5.

## Файлы аудита
Страницы `src/app/{partner,organization,manager,admin}/messages/page.tsx`; общий `components/chat/
order-thread-inbox.tsx` + `manager/manager-messages-inbox.tsx`; сервисы `chat/{threads,messages}.ts`,
`manager/messages.ts`; `lib/auth/requireRole.ts` (`requireOrganization`).
