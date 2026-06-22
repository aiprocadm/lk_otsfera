# Close-out — аудит семейства «Сообщения» (Track D, SP4)

FINDINGS: `docs/superpowers/specs/2026-06-22-messages-family-audit-FINDINGS.md`. Combined audit+fix (как SP1–SP3).

## Контекст
Семейство «Сообщения» особенное: бо́льшая часть ролевых различий **намеренна** по матрице гейтинга `chat`
(CLAUDE.md §5) — выравнивать нельзя. `OrderThreadInbox` уже общий для 4 ролей (Tier-2 merge), chrome почти
не дублируется. Отсюда находок мало: только дрейф заголовка и один off-canon auth-паттерн.

## Отгружено

- **DM1** заголовки: partner/org `font-bold`→`font-semibold`; manager/admin +`text-[#111111]` →
  во всех 4 канон `text-2xl font-semibold text-[#111111]` (R1). Обёртки manager/admin (фрагмент+`mb-4`,
  секции `mt-8`) НЕ переоформлялись — многосекционная раскладка использует явные отступы.
- **DM2** auth: `organization/messages` — единственная страница на сыром `getSession()` +
  `redirect('/login')`/`redirect('/forbidden')` → канонический `requireOrganization()` (Role-consistency
  ось3). Хелпер строже (требует активное членство) и совпадает с прочими org-страницами.

Намеренные различия (НЕ трогали, §5): гейтинг `chat` (partner/org `notFound` / manager order-comments-ungated /
admin graceful), `variant role/team`, условный UnreadBadge, секция «Комментарии к заказам» у manager.

## Верификация
typecheck ✅ · lint ✅ · test:unit (прогон) · build (после unit). e2e:visual operator-deferred.

## Остаток Track D
Семейства **Команда / Заявки на обучение** — отдельные подпроекты (SP5+).
