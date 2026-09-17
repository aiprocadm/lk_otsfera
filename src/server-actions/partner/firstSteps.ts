'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requirePartner } from '@/lib/auth/requireRole';
import { dismissPartnerFirstSteps } from '@/lib/services/partner/firstSteps';

/**
 * «Закрыть» блок «Первые шаги» у партнёра (`У-239`). Партнёр берётся из
 * сессии, а не из формы: чужое членство закрыть нельзя.
 */
export async function dismissPartnerFirstStepsAction(): Promise<void> {
  const session = await requirePartner();
  await dismissPartnerFirstSteps(prisma, { partnerId: session.partnerId, userId: session.sub });
  revalidatePath('/partner/dashboard');
}
