# Close-out — throw→Result contract (§3), волна 1

**План:** [2026-06-28-throw-to-result-contract.md](2026-06-28-throw-to-result-contract.md) · **Spec:** [../specs/2026-06-28-throw-to-result-contract-design.md](../specs/2026-06-28-throw-to-result-contract-design.md)
**Ветка:** `claude/throw-to-result-contract` · **PR:** #162 (merge `b301acc`)
**Метод:** subagent-driven-development (implementer + 2-стадийное ревью на задачу).

> Бэкфилл close-out (housekeeping): работа отгружена и в `main`, документ-закрытие отсутствовал. Продолжение — волна 2 ([2026-06-28-throw-to-result-wave2-DONE.md](2026-06-28-throw-to-result-wave2-DONE.md), PR #163), которая распространила тот же паттерн ещё на 8 сервисов.

## Что отгружено

Шесть сервисов переведены с `throw`-семантики на стабильный Result-контракт §3 (`{ ok: true; … } | { ok: false; error }`); роуты и server-actions стали тонкими мапперами кода→HTTP/UI.

| Сервис | Result-коды | Коммит |
|---|---|---|
| `partner/rateOverride.ts` (`setOrgCommissionRate`, `clearOrgCommissionRate`) | `org_out_of_scope`, `rate_out_of_range` | `32c1c73` |
| `partner/leads.ts` (`createLead`, `withdrawLead`) | `already_rejected`, `already_promoted` | `bd36ac9` |
| `enrollments/submit.ts` (`submitEnrollmentRequest`) | `forbidden`, `validation` | `f190b2b` |
| `manager/teamVisibility.ts` (`setTeamVisibility`) | `company_not_found`, `requires_admin` | `59cb140` |
| `commission/lifecycle.ts` (`approveStatement`, `markStatementPaid`) | `lifecycle_violation` | `f375f93` |
| `organization/team.ts` (invite/updateRole/deactivate/reactivate) | `already_member`, `last_admin_protected`, `self_action_forbidden` | `4e80539` (+ тест `dc24565`) |

**Локализация кодов** (`src/lib/errors/messages.ts`): 10 новых кодов → RU-строки (`3752e5f`), покрыты `lib.errorMessages.test.ts` (каждый код маппится на не-fallback строку).

**Тонкие роуты/actions:** `api/partner/portfolio/[orgId]/rate`, `api/partner/leads`(+`[id]`), `api/enrollments`, `api/partner/finance/statements/[id]`; server-actions `admin/organizations`, `manager/teamVisibility`, `organization/team` — все делегируют в сервис и мапят `if (!res.ok)`.

**Паттерн boundary-catch** (`organization/team`): catch перенесён внутрь сервиса, invite-shim ре-throw'ит — граница ловит и возвращает Result, не пропуская исключение в action.

## Гейты (merge-time, PR #162)

typecheck ✅ · lint ✅ · test:unit ✅ — тесты сервисов переписаны с `.rejects.toThrow` на Result-ассершены (`services.partner.rateOverride.unit`, `services.partner.leads.unit`, `services.enrollments.unit2`, `services.commission.lifecycle.unit`, `services.organization.team`, `server-actions.manager.teamVisibility`, `server-actions.organization.team`).

## Остаток

- Волна 2 (8 сервисов) — отгружена отдельно (PR #163), см. её close-out.
- Дальнейшие `throw`-сайты вне этих двух волн — по мере касания (не отдельный спринт).
