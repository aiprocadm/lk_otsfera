'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import { saveSettings, type SaveEntry } from '@/lib/config/integrationSettings';
import { resetEmailTransportCache } from '@/lib/email/transport';

export type IntegrationSaveResult =
  | { ok: true }
  | { ok: false; error: 'secrets_key_missing' | 'validation' };

function readField(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

/**
 * Сохранение настроек исходящей почты. Секрет (ключ Resend) присылается пустым,
 * если админ не вводил новый — тогда сервис его не затирает. После записи
 * сбрасываем кэш транспорта, чтобы новый ключ подхватился без перезапуска.
 */
export async function saveEmailSettingsAction(fd: FormData): Promise<IntegrationSaveResult> {
  const session = await requireAdmin();

  const enabled = fd.get('email_enabled') === 'on' || fd.get('email_enabled') === 'true';
  const from = readField(fd, 'email_from').trim();
  const apiKey = readField(fd, 'email_resendApiKey');

  const entries: SaveEntry[] = [
    { key: 'email.enabled', value: enabled ? 'true' : 'false' },
    { key: 'email.from', value: from },
    // Пустой ключ → saveSettings оставит существующий как есть.
    { key: 'email.resendApiKey', value: apiKey }
  ];

  const res = await saveSettings(prisma, session.sub, entries);
  if (!res.ok) return res;

  resetEmailTransportCache();
  revalidatePath('/admin/integrations');
  return { ok: true };
}
