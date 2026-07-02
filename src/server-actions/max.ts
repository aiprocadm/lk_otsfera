'use server';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { generateMaxLinkCode, unlinkMax } from '@/lib/services/max/link';

export async function generateMaxLinkAction() {
  const session = await requireSession();
  return generateMaxLinkCode(prisma, session);
}

export async function unlinkMaxAction() {
  const session = await requireSession();
  return unlinkMax(prisma, session);
}
