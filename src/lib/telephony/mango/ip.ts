import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';

const DEFAULT = '81.88.80.132,81.88.80.133,81.88.82.36';

/**
 * Список адресов, с которых принимаем вебхук Mango.
 *
 * `У-124`: значение берётся из настроек интерфейса, а при пустой настройке —
 * из переменной сервера, а при пустой переменной — из умолчания. Провайдер
 * меняет свои адреса без нашего участия, и раньше на это требовался деплой.
 */
function configuredAllowlist(): string {
  return cachedIntegrationSetting('mango.allowedIps') ?? process.env.MANGO_ALLOWED_IPS ?? DEFAULT;
}

/** Checks a client IP against the Mango Office webhook source allowlist. */
export function isMangoIpAllowed(ip: string, allowlist = configuredAllowlist()): boolean {
  const set = new Set(
    allowlist
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return set.has((ip ?? '').trim());
}

/** Client IP from proxy headers (x-forwarded-for first hop, then x-real-ip). */
export function clientIpFrom(headers: Headers): string {
  return (headers.get('x-forwarded-for')?.split(',')[0] ?? headers.get('x-real-ip') ?? '').trim();
}
