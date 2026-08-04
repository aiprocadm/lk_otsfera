import type { PrismaClient } from '@prisma/client';
import { setOrgCommissionRate, clearOrgCommissionRate } from '@/lib/services/partner/rateOverride';

export type ApplyOrgRateOverrideErrorCode = 'not_found' | 'validation' | 'rate_out_of_range';

// exactOptionalPropertyTypes: «ключа нет» и «ключ = undefined» здесь одно и то же
// (поле формы не заполнено).
export type ApplyOrgRateOverrideArgs = {
  organizationId: string;
  ratePercent?: number | undefined;
  reason: string;
  clear?: boolean | undefined;
  changedByUserId: string;
};

/**
 * Админская установка/снятие индивидуальной ставки комиссии по организации
 * (§9). Сервис-обёртка над `setOrgCommissionRate`/`clearOrgCommissionRate`:
 * сам разрешает partnerId по организации и решает, какую из двух операций
 * звать. Раньше это жило прямо в server-action.
 *
 * Порядок проверок сохранён дословно:
 *   1. организации нет                     → not_found
 *   2. организация без партнёра (standalone) → not_found
 *      (посреднической ставки у неё просто не существует — снимать/ставить нечего)
 *   3. clear=true                          → clearOrgCommissionRate
 *   4. задан ratePercent                   → setOrgCommissionRate (проценты → доля)
 *   5. не задано ни того, ни другого       → validation
 */
export async function applyOrgRateOverride(
  prisma: PrismaClient,
  args: ApplyOrgRateOverrideArgs
): Promise<{ ok: true } | { ok: false; error: ApplyOrgRateOverrideErrorCode }> {
  const org = await prisma.organization.findUnique({
    where: { id: args.organizationId },
    select: { partnerId: true },
  });
  if (!org) return { ok: false, error: 'not_found' };

  // Standalone orgs (no partner) have no intermediary-commission override to set/clear.
  if (org.partnerId === null) return { ok: false, error: 'not_found' };
  const partnerId: string = org.partnerId;

  if (args.clear) {
    return clearOrgCommissionRate(prisma, {
      organizationId: args.organizationId,
      partnerId,
      reason: args.reason,
      changedByUserId: args.changedByUserId,
    });
  }

  if (args.ratePercent !== undefined) {
    return setOrgCommissionRate(prisma, {
      organizationId: args.organizationId,
      partnerId,
      newRate: args.ratePercent / 100,
      reason: args.reason,
      changedByUserId: args.changedByUserId,
    });
  }

  return { ok: false, error: 'validation' };
}
