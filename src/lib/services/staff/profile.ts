import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

export type UpdateInternalPhoneResult = { ok: true } | { ok: false; error: 'invalid' };

/**
 * Настройки профиля сотрудника. Сейчас — только внутренний (АТС-добавочный)
 * номер, с которого Mango инициирует click-to-call (M2). Это внутренний
 * PBX-extension, а НЕ клиентский телефон: храним сырым (trim), НЕ прогоняя через
 * normalizePhoneCanonical. Пустая строка очищает номер (→ null).
 *
 * Правится ТОЛЬКО собственный профиль вызывающего (`session.sub`) — id из
 * входных данных не принимается, поэтому редактировать чужой добавочный нечем.
 */
export async function updateInternalPhone(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { internalPhone: string }
): Promise<UpdateInternalPhoneResult> {
  const value = args.internalPhone.trim();
  if (value.length > 32) return { ok: false, error: 'invalid' };

  await prisma.user.update({
    where: { id: session.sub },
    data: { internalPhone: value === '' ? null : value },
  });
  return { ok: true };
}
