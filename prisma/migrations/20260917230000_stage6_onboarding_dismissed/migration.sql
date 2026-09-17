-- Этап 6 PR-2 (У-239): «Первые шаги» — отметка «Закрыть» на членстве, не на пользователе.
-- Аддитивно и обратимо: две nullable-колонки.
ALTER TABLE "OrganizationUser" ADD COLUMN "onboardingDismissedAt" TIMESTAMP(3);
ALTER TABLE "PartnerUser" ADD COLUMN "onboardingDismissedAt" TIMESTAMP(3);
