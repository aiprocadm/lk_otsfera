import type { PrismaClient } from '@prisma/client';
import { getSettingValue } from '@/lib/config/integrationSettings';
import { log } from '@/lib/logging';

/**
 * Адрес учебной площадки (СДО) слушателя (`У-274`, ТЗ 13.10.2026, `Д-53`).
 *
 * Раньше адрес жил только в переменной сервера `STUDENT_REDIRECT_URL`; на стенде
 * там остался пример `lms.example.com`, и «Перейти к обучению» уводила на
 * несуществующий сайт. Теперь адрес задаётся в «Настройки → Интеграции →
 * Учебная площадка» (критерий §0.3), переменная — запасное значение. Пока адрес
 * пуст или указывает на заглушку, переход не выполняется — слушатель видит, что
 * площадка ещё не подключена.
 */

/** Домен учебной площадки заказчика — разрешён всегда (как и до `У-274`). */
const BUILTIN_ALLOWED_HOSTS = ['otsfera.cdoprof.com'];

/** Хосты-заглушки из примеров и тестовых зон: по ним сайта нет (RFC 2606). */
export function isPlaceholderPortalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    ['example.com', 'example.org', 'example.net'].some((d) => h === d || h.endsWith(`.${d}`)) ||
    ['.test', '.example', '.invalid', '.localhost'].some((tld) => h.endsWith(tld))
  );
}

export function parseHostList(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
    .filter((host) => !host.includes('*'));
}

export type StudentPortalConfig =
  { status: 'ready'; redirectUrl: string; allowlist: string[] } | { status: 'not_connected' };

export async function getStudentPortalConfig(prisma: PrismaClient): Promise<StudentPortalConfig> {
  const configured = (await getSettingValue(prisma, 'student.redirectUrl'))?.trim();
  const legacyUrl = process.env.STUDENT_PORTAL_URL?.trim();
  if (!configured && legacyUrl) {
    log.warn(
      '[student-redirect] STUDENT_PORTAL_URL is deprecated. Please migrate to STUDENT_REDIRECT_URL.'
    );
  }
  const redirectUrl = configured || legacyUrl;
  if (!redirectUrl) return { status: 'not_connected' };
  const parsed = URL.canParse(redirectUrl) ? new URL(redirectUrl) : null;
  // Заглушка из примера конфигурации — не «подключено», а «ещё нет».
  if (parsed && isPlaceholderPortalHost(parsed.hostname)) return { status: 'not_connected' };

  const configuredDomains = await getSettingValue(prisma, 'student.allowedDomains');
  const legacyDomains = process.env.STUDENT_PORTAL_ALLOWED_HOSTS;
  if (!configuredDomains?.trim() && legacyDomains) {
    log.warn(
      '[student-redirect] STUDENT_PORTAL_ALLOWED_HOSTS is deprecated. Please migrate to STUDENT_REDIRECT_ALLOWED_DOMAINS.'
    );
  }
  const domains = configuredDomains?.trim() ? configuredDomains : (legacyDomains ?? null);
  return {
    status: 'ready',
    redirectUrl,
    allowlist: [...BUILTIN_ALLOWED_HOSTS, ...parseHostList(domains)],
  };
}

export type PortalSettingsError = 'student_portal_url_invalid' | 'student_portal_host_not_allowed';

/**
 * Проверка формы «Учебная площадка»: адрес — https (пустой — «не подключено»),
 * его домен — среди разрешённых (встроенный или из поля), иначе переход
 * заблокирует проверка безопасности, и кнопка опять никуда не поведёт.
 */
export function validatePortalSettings(input: {
  redirectUrl: string;
  allowedDomains: string;
}): { ok: true } | { ok: false; error: PortalSettingsError } {
  const url = input.redirectUrl.trim();
  if (!url) return { ok: true };
  if (!URL.canParse(url)) return { ok: false, error: 'student_portal_url_invalid' };
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') return { ok: false, error: 'student_portal_url_invalid' };
  const allowed = [...BUILTIN_ALLOWED_HOSTS, ...parseHostList(input.allowedDomains)];
  if (!allowed.includes(parsed.hostname.toLowerCase())) {
    return { ok: false, error: 'student_portal_host_not_allowed' };
  }
  return { ok: true };
}
