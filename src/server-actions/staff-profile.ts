'use server';

import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';

/**
 * Настройки профиля сотрудника. Сейчас — только внутренний (АТС-добавочный)
 * номер, с которого Mango инициирует click-to-call (M2). Это внутренний
 * PBX-extension, а НЕ клиентский телефон: храним сырым (trim), НЕ прогоняя через
 * normalizePhoneCanonical. Пустая строка очищает номер (→ null).
 */
export async function updateInternalPhoneAction(args: {
  internalPhone: string;
}): Promise<{ ok: true } | { ok: false; error: 'invalid' }> {
  const session = await requireManager();
  const value = args.internalPhone.trim();
  if (value.length > 32) return { ok: false, error: 'invalid' };
  await prisma.user.update({
    where: { id: session.sub },
    data: { internalPhone: value === '' ? null : value },
  });
  return { ok: true };
}
