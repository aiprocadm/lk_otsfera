// @vitest-environment jsdom
/**
 * Добивка покрытия по группе «components-misc»: ветки, до которых не
 * дотягивались соседние тест-файлы.
 *
 *  1. страница «Личная безопасность» руководителя — включённый флаг staff_2fa
 *     (в соседнем тесте с флагом рендерилась только админская страница);
 *  2. AuditDiffDialog — пустая строка в значении поля показывается прочерком.
 *
 * Пункт про `LeaderAppShell` (фильтр «Настройки» по `hasAnySettingsAccess`)
 * уехал в `pages.cabinet-layouts.test.tsx`: этап 2 схлопнул пять шеллов в один,
 * и фильтр теперь живёт в `app/leader/layout.tsx`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

import type { SessionPayload } from '@/lib/auth/jwt';

const LEADER: SessionPayload = { sub: 'l1', role: 'leader' };

// --- страница «Личная безопасность» руководителя ---
const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('@/components/settings/security-card', () => ({
  SecurityCard: () => React.createElement('div', { 'data-testid': 'security-card' }, 'SECURITY'),
}));
vi.mock('@/components/settings/staff-backup-codes-section', () => ({
  StaffBackupCodesSection: () =>
    React.createElement('div', { 'data-testid': 'backup-codes' }, 'BACKUP'),
}));

import LeaderPersonalSecurityPage from '@/app/leader/settings/security/personal/page';
import { AuditDiffDialog } from '@/components/admin/audit-diff-dialog';

describe('Личная безопасность руководителя — старый адрес (`У-114`)', () => {
  beforeEach(() => {
    requireSettingsSection.mockReset().mockResolvedValue(LEADER);
    isFeatureEnabled.mockReset();
    redirect.mockReset();
  });

  it('уводит на вкладку «Безопасность» нового раздела, а не в 404', () => {
    LeaderPersonalSecurityPage();
    expect(redirect).toHaveBeenCalledWith('/leader/settings/personal?tab=security');
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
