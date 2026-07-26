# Этап 8 PR-1 — Реквизиты (ФТ-9.1, ФТ-9.2)

Спека: [2026-07-26-stage8-requisites-docgen-design.md](../specs/2026-07-26-stage8-requisites-docgen-design.md) §3–4 (подтверждена 26.07.2026).
Ветка `claude/stage8-requisites-docgen`. Счётчик/генерация — PR-2.

## A. Модель (аддитивная миграция)

- [x] `Organization` + `legalName?`, `ogrn?`, `legalAddress?`, `bankName?`,
      `bankAccount?`, `corrAccount?`, `bic?`, `signerName?`, `signerPosition?`,
      `signerBasis?`.
- [x] `Partner` + `kpp?` + тот же набор (legalName/inn уже есть).
- [x] `Company` + `inn?`, `kpp?`, `ogrn?`, `legalName?`, `legalAddress?`,
      банк ×4, подписант ×3, `phone?`, `email?`.
- [x] Скраббер логов: `signerName` (ПДн подписанта) в `lib/logging/scrub`.

## B. Сервисы (Result-контракт, аудит `requisites_changed`)

- [x] Общий чистый валидатор `lib/requisites/validate.ts`: формат ИНН
      (10/12), КПП (9), ОГРН (13/15), БИК (9), р/с и к/с (20 цифр) — поля
      опциональны, но заполненные проверяются; русские сообщения.
- [x] `services/organization/requisites.ts` — get/set своей организации
      (роль organization, только admin|leader организации).
- [x] `services/partner/requisites.ts` — get/set партнёра (только
      partner-admin).
- [x] `services/admin/company.ts` — get/set реквизитов Company (admin-only).
- [x] Admin-правка реквизитов орг/партнёра — отдельным сервисом
      `admin/counterpartyRequisites` (та же валидация/аудит), НЕ расширением
      узких updateOrganization/updatePartner: меньше риска для покрытых форм,
      переиспользуется общая карточка. (Отклонение от первоначальной
      формулировки — осознанное.)

## C. UI

- [x] Презентационный `RequisitesFields` (domain-agnostic поля +
      defaultValues + PartyAutocomplete по ИНН с автозаполнением
      названия/КПП/ОГРН/адреса) — переиспользуется всеми формами (§4
      sibling-rule: строго презентационный).
- [x] `OrgRequisitesCard` на `/organization/settings` + server-action.
- [x] `PartnerRequisitesCard` на `/partner/settings` + server-action.
- [x] `CompanyRequisitesCard` на `/admin/settings` + server-action.
- [x] Admin-редакторы: карточка «Реквизиты для документов» рядом с
      существующими `OrganizationEditForm`/`PartnerEditForm` на
      /admin/organizations/[id] и /admin/partners/[id].
- [x] Read-only таб «Реквизиты» карточки организации менеджера — полный
      набор (select `getOrganizationCard` расширить).

## D. Тесты (порог 100%)

- [x] Unit: валидатор (матрица форматов), сервисы ×4 (гейты ролей/подролей,
      чужая орг/партнёр → forbidden, идемпотентность, аудит),
      server-actions, компоненты (Fields + 3 карточки + admin-формы),
      страницы настроек ×3, org-card details.
- [x] Integration (живой Postgres): организация сохраняет реквизиты →
      менеджер видит в карточке; партнёр/компания; RBAC-негативы.
- [x] Актуализация затронутых (страницы настроек, admin-формы, org-card).

## E. Финал

- [x] typecheck / lint / unit / integration зелёные; CHANGELOG; STATUS.md; PR.
