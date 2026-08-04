import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';
import type { SessionAccessProfile } from '@/lib/auth/accessProfile';
import { SETTINGS_SECTIONS, type SettingsSection } from '@/lib/navigation/settings';
import {
  canAccessSettingsSection,
  hasAnySettingsAccess,
  settingsCabinetFor,
  visibleSettingsSections,
} from '@/lib/auth/settingsAccess';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  // Конструктор ролей — opt-in флаг; раздел «Роли» без него скрыт.
  process.env.FEATURE_ROLE_CONSTRUCTOR = '1';
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function section(id: string): SettingsSection {
  const found = SETTINGS_SECTIONS.find((s) => s.id === id);
  if (!found) throw new Error(`нет раздела ${id}`);
  return found;
}

function admin(over: Partial<SessionPayload> = {}): SessionPayload {
  return { sub: 'a1', role: 'admin', ...over } as unknown as SessionPayload;
}
function leader(over: Partial<SessionPayload> = {}): SessionPayload {
  return {
    sub: 'm1',
    role: 'manager',
    managerRole: 'leader',
    companyId: 'co-1',
    managedOrgIds: [],
    ...over,
  } as unknown as SessionPayload;
}
function profile(capabilities: SessionAccessProfile['capabilities']): SessionAccessProfile {
  return {
    id: 'p1',
    name: 'Роль',
    orders: 'all',
    organizations: 'all',
    threads: 'all',
    documents: 'all',
    finance: 'all',
    leads: 'all',
    tasks: 'all',
    capabilities,
  };
}

describe('settingsCabinetFor', () => {
  it('admin → админский хаб, руководитель → свой, обычный менеджер → никакой', () => {
    expect(settingsCabinetFor(admin())).toBe('admin');
    expect(settingsCabinetFor(leader())).toBe('leader');
    expect(settingsCabinetFor(leader({ managerRole: null } as never))).toBeNull();
    expect(settingsCabinetFor({ sub: 'p', role: 'partner' } as never)).toBeNull();
  });
});

describe('canAccessSettingsSection', () => {
  it('admin видит любой раздел своего кабинета (Model A)', () => {
    for (const s of SETTINGS_SECTIONS.filter((x) => x.cabinets.includes('admin'))) {
      expect(canAccessSettingsSection(admin(), s)).toBe(true);
    }
  });

  it('руководитель без профиля сохраняет прежний доступ (критерий приёмки 5)', () => {
    expect(canAccessSettingsSection(leader(), section('access.roles'))).toBe(true);
    expect(canAccessSettingsSection(leader(), section('catalogs.customFields'))).toBe(true);
  });

  it('профиль без единого settings-кода — прежний доступ («дедушкина оговорка»)', () => {
    const s = leader({ accessProfile: profile(['export', 'see_commission']) } as never);
    expect(canAccessSettingsSection(s, section('access.roles'))).toBe(true);
  });

  it('размеченный профиль: разрешён только свой раздел, остальные — отказ', () => {
    const s = leader({ accessProfile: profile(['settings.catalogs.manage']) } as never);
    expect(canAccessSettingsSection(s, section('catalogs.customFields'))).toBe(true);
    expect(canAccessSettingsSection(s, section('access.roles'))).toBe(false);
  });

  it('чужой кабинет не открывается: аудита у руководителя нет', () => {
    expect(canAccessSettingsSection(leader(), section('security.audit'))).toBe(false);
    // и наоборот — admin не ходит в leader-хаб (Model A: кабинеты не смешиваются)
    expect(canAccessSettingsSection(admin(), section('access.roles'), 'leader')).toBe(false);
  });

  it('обычный менеджер (без роли руководителя) не видит ничего', () => {
    const s = leader({ managerRole: null } as never);
    expect(canAccessSettingsSection(s, section('catalogs.customFields'))).toBe(false);
    expect(hasAnySettingsAccess(s, 'leader')).toBe(false);
  });

  it('раздел под выключенным флагом скрыт даже у admin', () => {
    delete process.env.FEATURE_ROLE_CONSTRUCTOR;
    expect(canAccessSettingsSection(admin(), section('access.roles'))).toBe(false);
    expect(visibleSettingsSections(admin(), 'admin').map((s) => s.id)).not.toContain(
      'access.roles'
    );
  });
});

describe('visibleSettingsSections / hasAnySettingsAccess', () => {
  it('порядок разделов сохраняется как в реестре', () => {
    const visible = visibleSettingsSections(admin(), 'admin').map((s) => s.id);
    const expected = SETTINGS_SECTIONS.filter((s) => s.cabinets.includes('admin')).map((s) => s.id);
    expect(visible).toEqual(expected);
  });

  it('руководитель видит только свои разделы', () => {
    expect(visibleSettingsSections(leader(), 'leader').map((s) => s.id)).toEqual([
      'integrations.notifications',
      'catalogs.applicationStatuses',
      'catalogs.customFields',
      'access.roles',
      'security.personal',
    ]);
  });

  it('профиль, где размечен только чужой раздел, оставляет пункт меню скрытым', () => {
    const s = leader({ accessProfile: profile(['settings.audit.view']) } as never);
    expect(hasAnySettingsAccess(s, 'leader')).toBe(false);
  });

  it('у admin доступ есть всегда', () => {
    expect(hasAnySettingsAccess(admin(), 'admin')).toBe(true);
  });
});
