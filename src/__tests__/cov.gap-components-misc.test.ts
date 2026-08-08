// @vitest-environment jsdom
/**
 * Добивка покрытия по группе «components-misc»: три ветки, до которых не
 * дотягивались соседние тест-файлы.
 *
 *  1. LeaderAppShell — фильтр пункта «Настройки» по hasAnySettingsAccess
 *     (ТЗ 2026-08-04 §5.2): правое плечо `||` не исполнялось, потому что в
 *     соседнем тесте меню не содержало /leader/settings;
 *  2. страница «Личная безопасность» руководителя — включённый флаг staff_2fa
 *     (в соседнем тесте с флагом рендерилась только админская страница);
 *  3. AuditDiffDialog — пустая строка в значении поля показывается прочерком.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { render } from '@testing-library/react';
import { renderServerComponent } from './helpers/renderServerComponent';

// --- оболочка кабинета руководителя ---
const { navItemsFor } = vi.hoisted(() => ({ navItemsFor: vi.fn() }));
vi.mock('@/lib/navigation/cabinet', () => ({ navItemsFor }));

const { hasAnySettingsAccess } = vi.hoisted(() => ({ hasAnySettingsAccess: vi.fn() }));
vi.mock('@/lib/auth/settingsAccess', () => ({ hasAnySettingsAccess }));

vi.mock('@/components/ui', () => ({
  LogoutButton: () => React.createElement('button', null, 'Выйти'),
}));

vi.mock('@/components/leader/leader-sidebar', () => ({
  LeaderSidebar: (props: { items: Array<{ href: string; label: string }> }) =>
    React.createElement(
      'nav',
      { 'data-testid': 'leader-sidebar' },
      props.items.map((item) =>
        React.createElement('a', { key: item.href, href: item.href }, item.label)
      )
    ),
}));

vi.mock('@/components/notifications/notification-bell', () => ({
  NotificationBell: () => React.createElement('span', null, '🔔'),
}));

// --- страница «Личная безопасность» руководителя ---
const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('@/components/settings/security-card', () => ({
  SecurityCard: () => React.createElement('div', { 'data-testid': 'security-card' }, 'SECURITY'),
}));
vi.mock('@/components/settings/staff-backup-codes-section', () => ({
  StaffBackupCodesSection: () =>
    React.createElement('div', { 'data-testid': 'backup-codes' }, 'BACKUP'),
}));

import { LeaderAppShell } from '@/components/leader/leader-app-shell';
import LeaderPersonalSecurityPage from '@/app/leader/settings/security/personal/page';
import { AuditDiffDialog } from '@/components/admin/audit-diff-dialog';
import type { SessionPayload } from '@/lib/auth/jwt';

const LEADER: SessionPayload = { sub: 'l1', role: 'manager', managerRole: 'leader' };

// children кладём в объект пропсов (а не третьим аргументом createElement):
// у оболочки children обязателен, и перегрузки createElement требуют его сразу.
// Тот же приём, что в components.leader-app-shell.test.tsx.
function renderShell(session: SessionPayload): string {
  const props: React.ComponentProps<typeof LeaderAppShell> = { session, children: 'контент' };
  return renderToString(React.createElement(LeaderAppShell, props));
}

describe('LeaderAppShell — пункт «Настройки» в меню', () => {
  beforeEach(() => {
    navItemsFor.mockReset().mockReturnValue([
      { href: '/leader/dashboard', label: 'Сводка' },
      { href: '/leader/settings', label: 'Настройки' },
    ]);
    hasAnySettingsAccess.mockReset();
  });

  it('оставляет пункт, когда доступен хотя бы один раздел настроек', () => {
    hasAnySettingsAccess.mockReturnValue(true);

    const html = renderShell(LEADER);

    // Право спрашивается именно для кабинета руководителя.
    expect(hasAnySettingsAccess).toHaveBeenCalledWith(LEADER, 'leader');
    expect(html).toContain('href="/leader/settings"');
    expect(html).toContain('href="/leader/dashboard"');
  });

  it('убирает пункт, когда не доступен ни один раздел (остальное меню цело)', () => {
    hasAnySettingsAccess.mockReturnValue(false);

    const html = renderShell(LEADER);

    expect(html).not.toContain('href="/leader/settings"');
    // Проверка спрашивается только у пункта настроек — остальные не фильтруются.
    expect(hasAnySettingsAccess).toHaveBeenCalledTimes(1);
    expect(html).toContain('href="/leader/dashboard"');
    expect(html).toContain('Сводка');
  });
});

describe('Личная безопасность руководителя — флаг staff_2fa', () => {
  beforeEach(() => {
    requireSettingsSection.mockReset().mockResolvedValue(LEADER);
    isFeatureEnabled.mockReset();
  });

  it('с включённым staff_2fa показывает секцию кодов восстановления', async () => {
    isFeatureEnabled.mockReturnValue(true);

    const { container } = await renderServerComponent(LeaderPersonalSecurityPage());

    expect(requireSettingsSection).toHaveBeenCalledWith('security.personal', 'leader');
    expect(isFeatureEnabled).toHaveBeenCalledWith('staff_2fa');
    expect(container.querySelector('[data-testid="backup-codes"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="security-card"]')).not.toBeNull();
  });
});

describe('AuditDiffDialog — пустая строка в значении поля', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  it('показывает прочерк вместо пустого места, когда поле стёрли', () => {
    const row = {
      id: 'a1',
      createdAt: new Date(),
      actor: null,
      action: 'user_updated',
      entity: 'user' as const,
      entityId: 'u1',
      meta: { before: { name: 'Пётр' }, after: { name: '' } },
    } as any;

    const { container } = render(React.createElement(AuditDiffDialog, { row, onClose: () => {} }));

    const values = Array.from(container.querySelectorAll('dd')).map((dd) => dd.textContent);
    // Слева — прежнее значение, справа — прочерк (а не пустая ячейка).
    expect(values).toEqual(['Пётр', '—']);
  });
});
