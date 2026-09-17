'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireOrganization } from '@/lib/auth/requireRole';
import { activeOrgIds } from '@/lib/auth/organizationPolicy';
import { dismissOrgFirstSteps } from '@/lib/services/organization/firstSteps';

/**
 * «Закрыть» блок «Первые шаги» у заказчика (`У-239`). Форма без JS: результат
 * не возвращаем — после действия главная перечитывается, и блока на ней нет.
 * Чужую организацию (не из членств сессии) не трогаем: и сервис пишет только
 * по членству, и сюда чужой id не пропускаем — два слоя защиты (§4).
 */
export async function dismissOrgFirstStepsAction(formData: FormData): Promise<void> {
  const session = await requireOrganization();
  const organizationId = String(formData.get('organizationId') ?? '');
  if (!activeOrgIds(session).includes(organizationId)) return;
  await dismissOrgFirstSteps(prisma, { organizationId, userId: session.sub });
  revalidatePath('/organization/dashboard');
}
