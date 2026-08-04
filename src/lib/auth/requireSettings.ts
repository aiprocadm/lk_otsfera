import { notFound, redirect } from 'next/navigation';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { SETTINGS_SECTIONS, type SettingsCabinet } from '@/lib/navigation/settings';
import { canAccessSettingsSection } from '@/lib/auth/settingsAccess';
import { requireAdmin, requireManagerLeader } from '@/lib/auth/requireRole';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Серверный гард подраздела настроек. Вызывается КАЖДОЙ страницей хаба — права
 * проверяются на каждый запрос, а не скрытием карточки (ТЗ §5.2: скрытая ссылка
 * без серверной проверки — это не защита).
 *
 * Отказ по правам → `/forbidden` (русская страница 403, единый контракт
 * под-ролей). Выключенный флаг раздела → 404, как и раньше на `/admin/roles`:
 * существование выключенной фичи не раскрываем.
 */
export async function requireSettingsSection(
  sectionId: string,
  cabinet: SettingsCabinet
): Promise<SessionPayload> {
  const session = cabinet === 'admin' ? await requireAdmin() : await requireManagerLeader();
  const section = SETTINGS_SECTIONS.find((s) => s.id === sectionId);
  /* v8 ignore next -- раздела нет только при опечатке в id: страховка от «молча открытой» страницы */
  if (!section) redirect('/forbidden');
  if (section.flag && !isFeatureEnabled(section.flag)) notFound();
  if (!canAccessSettingsSection(session, section, cabinet)) redirect('/forbidden');
  return session;
}
