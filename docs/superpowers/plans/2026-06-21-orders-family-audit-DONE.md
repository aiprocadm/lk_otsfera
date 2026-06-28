# Close-out — аудит семейства «Заказы» (Track D)

**План:** [2026-06-21-orders-family-audit.md](2026-06-21-orders-family-audit.md)
**Findings:** [../specs/2026-06-21-orders-family-audit-FINDINGS.md](../specs/2026-06-21-orders-family-audit-FINDINGS.md)
**Ветка/PR:** #141 (merge `2792819`) · findings-коммит `f634a1f`.

> Бэкфилл close-out (housekeeping). Аудит породил findings-документ (он же артефакт-закрытие); ремедиация — отдельный план [2026-06-21-orders-family-remediation.md](2026-06-21-orders-family-remediation.md) (см. её [close-out](2026-06-21-orders-family-remediation-DONE.md)).

## Что отгружено

**Аудит** (`FINDINGS.md`): таблица 6 осей (навигация / действия / фидбек / состояния / подтверждения / кросс-ролевая консистентность) × 5 ролей (partner/organization/manager/leader/admin) по экранам заказов; находки F1–F8 с severity + «Открытые решения для владельца» (R1–R4) — переданы на ратификацию.

**DRY-извлечения (безопасное подмножество):**
- `pluralizeRu` → `src/lib/format.ts` (тест `lib.format.test.ts`); подключён в `organization/orders` и `partner/deals`. Коммит `3607a01`.
- `Paginator` → `src/components/ui/paginator.tsx` (параметризован `basePath`/`searchParams`, тест `components.ui-paginator.test.tsx`); подключён в обе списочные страницы. Коммит `4b6e910`.

## Гейты (merge-time, PR #141)

typecheck ✅ · lint ✅ · test:unit ✅ · build ✅.

## Остаток

- Ратификационно-зависимые правки (F1/F3/F4 канон заголовков, мобильные карточки, leader-детали, диалог-подтверждение) реализованы в плане ремедиации (R1–R5).
- Прочие семейства Track D (Документы / Финансы / Сообщения / Команда / Заявки) — отдельные под-проекты, закрыты своими `*-family-audit-DONE.md`.
