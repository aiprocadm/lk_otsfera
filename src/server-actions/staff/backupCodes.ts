'use server';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { generateBackupCodes } from '@/lib/services/auth/twoFactor';
import { recordAudit } from '@/lib/auth/audit';

// Self-service перевыпуск кодов восстановления 2FA. Staff-гейт: admin | manager
// (leader — самостоятельная staff-роль, ТЗ 2026-08-17). За флагом
// staff_2fa — без него секция не рендерится и action недоступен.
export async function regenerateBackupCodesAction(): Promise<
  { ok: true; codes: string[] } | { ok: false; error: 'forbidden' }
> {
  const session = await getSession();
  const isStaff = !!session && (session.role === 'admin' || isStaffManagerSide(session));
  if (!isStaff || !isFeatureEnabled('staff_2fa')) return { ok: false, error: 'forbidden' };

  const { codes } = await generateBackupCodes(prisma, session.sub);
  await recordAudit(prisma, {
    action: '2fa_backup_regenerated',
    entity: 'auth_2fa',
    entityId: session.sub,
    userId: session.sub,
  }).catch(() => {});
  return { ok: true, codes };
}
