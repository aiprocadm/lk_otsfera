'use server';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import {
  saveWhatsappPhone,
  updateChannelPreference,
} from '@/lib/services/notifications/preferences';

export async function updateChannelPreferenceAction(channel: string, enabled: boolean) {
  const session = await requireSession();
  return updateChannelPreference(prisma, session, { channel, enabled });
}

export async function saveWhatsappPhoneAction(phone: string) {
  const session = await requireSession();
  return saveWhatsappPhone(prisma, session, { phone });
}
