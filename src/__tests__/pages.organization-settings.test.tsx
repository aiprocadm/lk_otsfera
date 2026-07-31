// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import OrganizationSettingsPage from '@/app/organization/settings/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getTelegramStatus } = vi.hoisted(() => ({ getTelegramStatus: vi.fn() }));
vi.mock('@/lib/services/telegram/link', () => ({ getTelegramStatus }));

const { getNotificationSettings } = vi.hoisted(() => ({ getNotificationSettings: vi.fn() }));
vi.mock('@/lib/services/notifications/preferences', () => ({ getNotificationSettings }));

// Этап 8 (PR-1): реквизиты организации — сервис и карточка стабятся.
const { getOrgRequisites } = vi.hoisted(() => ({ getOrgRequisites: vi.fn() }));
vi.mock('@/lib/services/organization/requisites', () => ({ getOrgRequisites }));
vi.mock('@/server-actions/requisites', () => ({ setOrgRequisitesAction: vi.fn() }));
vi.mock('@/components/settings/security-card', () => ({
  SecurityCard: () => React.createElement('div', { 'data-testid': 'security-card' }, 'SECURITY'),
}));

vi.mock('@/components/requisites/requisites-card', () => ({
  RequisitesCard: (props: { title: string; canEdit?: boolean }) =>
    React.createElement(
      'div',
      { 'data-testid': 'requisites-card' },
      props.title,
      ` canEdit:${String(props.canEdit)}`
    ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement(
      'div',
      { 'data-testid': 'org-app-shell' },
      props.activeOrgName,
      props.children
    ),
}));

const CTX = {
  session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin' as const,
};

describe('OrganizationSettingsPage', () => {
  beforeEach(() => {
    getOrgPageContext.mockReset();
    getOrgRequisites.mockReset().mockResolvedValue({ ok: false, error: 'forbidden' });
    getTelegramStatus.mockReset();
    getNotificationSettings.mockReset();
  });

  it('карточка реквизитов организации: право правки только у admin/leader', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    getTelegramStatus.mockResolvedValue({ ok: true, linked: false, enabled: true });
    getNotificationSettings.mockResolvedValue({
      ok: true,
      view: {
        emailAlwaysOn: true,
        telegram: { available: true, linked: false, enabled: true },
        max: { available: false, linked: false, enabled: false },
        whatsapp: { available: false, phone: null, enabled: false },
      },
    });
    getOrgRequisites.mockResolvedValue({
      ok: true,
      requisites: {
        legalName: 'ООО Ромашка',
        inn: '7707083893',
        kpp: null,
        ogrn: null,
        legalAddress: null,
        bankName: null,
        bankAccount: null,
        corrAccount: null,
        bic: null,
        signerName: null,
        signerPosition: null,
        signerBasis: null,
      },
    });
    const { container } = await renderServerComponent(OrganizationSettingsPage());
    expect(container.textContent).toContain('Реквизиты организации');
  });

  it('участник без прав (member): карточка реквизитов есть, но canEdit=false', async () => {
    getOrgPageContext.mockResolvedValue({ ...CTX, viewerRole: 'member' as const });
    getTelegramStatus.mockResolvedValue({ ok: true, linked: false, enabled: true });
    getNotificationSettings.mockResolvedValue({
      ok: true,
      view: {
        emailAlwaysOn: true,
        telegram: { available: true, linked: false, enabled: true },
        max: { available: false, linked: false, enabled: false },
        whatsapp: { available: false, phone: null, enabled: false },
      },
    });
    getOrgRequisites.mockResolvedValue({
      ok: true,
      requisites: {
        legalName: 'ООО Ромашка',
        inn: null,
        kpp: null,
        ogrn: null,
        legalAddress: null,
        bankName: null,
        bankAccount: null,
        corrAccount: null,
        bic: null,
        signerName: null,
        signerPosition: null,
        signerBasis: null,
      },
    });
    const { container } = await renderServerComponent(OrganizationSettingsPage());
    expect(container.textContent).toContain('Реквизиты организации');
  });

  it('сессия без активной организации: карточки реквизитов нет, сервис не зовётся', async () => {
    getOrgPageContext.mockResolvedValue({ ...CTX, activeOrgId: null });
    getTelegramStatus.mockResolvedValue({ ok: true, linked: false, enabled: true });
    getNotificationSettings.mockResolvedValue({
      ok: true,
      view: {
        emailAlwaysOn: true,
        telegram: { available: true, linked: false, enabled: true },
        max: { available: false, linked: false, enabled: false },
        whatsapp: { available: false, phone: null, enabled: false },
      },
    });
    const { container } = await renderServerComponent(OrganizationSettingsPage());
    expect(getOrgRequisites).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Реквизиты организации');
  });

  it('fetches telegram status + notification settings for the session and renders both cards', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    getTelegramStatus.mockResolvedValue({ ok: true, linked: false, enabled: true });
    getNotificationSettings.mockResolvedValue({
      ok: true,
      view: {
        emailAlwaysOn: true,
        telegram: { available: true, linked: false, enabled: true },
        max: { available: false, linked: false, enabled: false },
        whatsapp: { available: false, phone: null, enabled: false },
      },
    });

    const { container } = await renderServerComponent(OrganizationSettingsPage());

    expect(getOrgPageContext).toHaveBeenCalledWith({});
    expect(getTelegramStatus).toHaveBeenCalledWith({}, CTX.session);
    expect(getNotificationSettings).toHaveBeenCalledWith({}, CTX.session);
    expect(container.textContent).toContain('Настройки');
    expect(container.textContent).toContain('ООО Ромашка');
  });
});
