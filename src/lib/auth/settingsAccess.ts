import { isFeatureEnabled } from '@/lib/featureFlags';
import {
  SETTINGS_CAPABILITIES,
  type Capability,
  type SettingsCapability,
} from '@/lib/auth/accessProfileSchema';
import {
  sectionsForCabinet,
  type SettingsCabinet,
  type SettingsSection,
} from '@/lib/navigation/settings';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isManagerLeader } from '@/lib/auth/roleModel';

/**
 * Права на разделы хаба «Настройки» (ТЗ 2026-08-04 §5.2).
 *
 * Слой наслаивается на существующий `AccessProfile`, НЕ ломая legacy:
 *
 *  1. admin — доступ ко всему (Model A, как в `can()`);
 *  2. кабинет должен подходить роли (в leader-хаб пускает только руководитель);
 *  3. профиля нет → прежнее поведение (критерий приёмки 5 ТЗ);
 *  4. профиль есть, но НИ ОДНОГО `settings.*`-кода в нём не размечено → тоже
 *     прежнее поведение. Без этой оговорки включение новой модели молча отняло
 *     бы доступ у всех ранее заведённых профилей — это «наслоение без ломки
 *     legacy» из ТЗ, а не поблажка;
 *  5. профиль размечен → default-deny: нужен код именно этого раздела.
 *
 * Проверка обязана вызываться на КАЖДЫЙ запрос в layout'е хаба: скрытая
 * карточка без серверной проверки — это не право доступа, а внешний вид.
 */

const SETTINGS_CAPABILITY_SET: ReadonlySet<string> = new Set(SETTINGS_CAPABILITIES);

function isSettingsCapability(c: Capability): c is SettingsCapability {
  return SETTINGS_CAPABILITY_SET.has(c);
}

/** Кабинет сотрудника по сессии: admin → админский, руководитель → свой. */
export function settingsCabinetFor(session: SessionPayload): SettingsCabinet | null {
  if (session.role === 'admin') return 'admin';
  if (isManagerLeader(session)) return 'leader';
  return null;
}

export function canAccessSettingsSection(
  session: SessionPayload,
  section: SettingsSection,
  cabinet?: SettingsCabinet
): boolean {
  const target = cabinet ?? settingsCabinetFor(session);
  if (!target) return false;
  if (!section.cabinets.includes(target)) return false;
  if (settingsCabinetFor(session) !== target) return false;
  if (section.flag && !isFeatureEnabled(section.flag)) return false;

  // `У-114`: личные настройки — не власть, а свои же данные. Разметка профиля
  // доступа их не отнимает: иначе сотрудник не смог бы отвязать свой Telegram.
  if (section.capability === 'own') return true;

  if (session.role === 'admin') return true;

  const profile = session.accessProfile;
  if (!profile) return true;
  const declared = profile.capabilities.filter(isSettingsCapability);
  if (declared.length === 0) return true;
  return declared.includes(section.capability);
}

/** Разделы кабинета, доступные этой сессии, в порядке реестра. */
export function visibleSettingsSections(
  session: SessionPayload,
  cabinet: SettingsCabinet
): SettingsSection[] {
  return sectionsForCabinet(cabinet).filter((s) => canAccessSettingsSection(session, s, cabinet));
}

/**
 * Есть ли доступ хотя бы к одному разделу. Пункт «Настройки» в меню не
 * показывается вовсе, если ответ false (ТЗ §5.2).
 */
export function hasAnySettingsAccess(session: SessionPayload, cabinet: SettingsCabinet): boolean {
  return visibleSettingsSections(session, cabinet).length > 0;
}
