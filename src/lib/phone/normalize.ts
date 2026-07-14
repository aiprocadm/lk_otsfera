/**
 * Единый канон телефонов для хранения и матчинга (M2). Заменяет три
 * расходящихся нормализатора (inbound/resolve, telephony/resolveCaller,
 * notifications/preferences). RU-национальный 8XXXXXXXXXX (11 цифр) → +7XXXXXXXXXX;
 * иначе — только цифры с ведущим '+'. Пустой ввод → ''.
 */
export function normalizePhoneCanonical(raw: string): string {
  const digits = (raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`;
  return `+${digits}`;
}
