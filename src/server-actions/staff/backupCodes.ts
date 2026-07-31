'use server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { generateBackupCodes } from '@/lib/services/auth/twoFactor';
import { recordAudit } from '@/lib/auth/audit';

// Self-service перевыпуск кодов восстановления 2FA. Staff-гейт: admin | manager
// (leader — это manager с managerRole='leader', отдельной ветки нет). За флагом
// staff_2fa — без него секция не рендерится и action недоступен.
export async function regenerateBackupCodesAction(): Promise<
  { ok: true; codes: string[] } | { ok: false; error: 'forbidden' }
> {
  const session = await getSession();
  const isStaff = !!session && (session.role === 'admin' || session.role === 'manager');
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
