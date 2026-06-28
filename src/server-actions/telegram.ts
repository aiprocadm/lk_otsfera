'use server';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { generateLinkCode, unlinkTelegram } from '@/lib/services/telegram/link';

export async function generateTelegramLinkAction() {
  const session = await requireSession();
  return generateLinkCode(prisma, session);
}

export async function unlinkTelegramAction() {
  const session = await requireSession();
  return unlinkTelegram(prisma, session);
}
