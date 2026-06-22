# План — аудит семейства «Заявки на обучение» (Track D, SP6 — финал)

FINDINGS: `docs/superpowers/specs/2026-06-22-enrollments-family-audit-FINDINGS.md`.

## Задачи
- [x] A1 — FINDINGS (5 ролей; самое консистентное семейство; submitter/processor — намеренно).
- [x] DE1 — org-заголовок `font-bold`→`font-semibold` (единственная находка; 4 другие роли уже на каноне).
- [ ] Гейты: typecheck ✅ · lint ✅ · test:unit (в процессе) · build (в процессе).
- [ ] Close-out (-DONE.md) + закрытие Track D.

## Открытых решений владельцу нет.
submitter (`EnrollmentList`) vs processor (`EnrollmentQueue`), отсутствие формы у leader — намеренные доменные роли.
