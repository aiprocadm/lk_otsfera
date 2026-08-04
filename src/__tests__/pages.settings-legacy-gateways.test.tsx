// @vitest-environment jsdom
/**
 * Шлюзы старых маршрутов (ТЗ §5.1): ни один сохранённый адрес не должен отдать
 * 404. Каждый старый путь обязан спросить `redirectToSettingsHub` со СВОИМ
 * адресом (иначе редирект уедет не туда) и, когда хаб выключен, отрисовать
 * прежнюю страницу на месте.
 *
 * Сама карта редиректов проверяется в lib.navigation.settings, поведение флага —
 * в lib.navigation.settings-redirect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { redirectToSettingsHub } = vi.hoisted(() => ({ redirectToSettingsHub: vi.fn() }));
vi.mock('@/lib/navigation/settingsRedirect', () => ({ redirectToSettingsHub }));

vi.mock('@/app/admin/settings/catalogs/application-statuses/page', () => ({
  default: () => React.createElement('div', null, 'СОДЕРЖИМОЕ:/admin/order-statuses'),
}));
vi.mock('@/app/admin/settings/catalogs/custom-fields/page', () => ({
  default: () => React.createElement('div', null, 'СОДЕРЖИМОЕ:/admin/custom-fields'),
}));
vi.mock('@/app/leader/settings/catalogs/application-statuses/page', () => ({
  default: () => React.createElement('div', null, 'СОДЕРЖИМОЕ:/leader/settings/order-statuses'),
}));
vi.mock('@/app/leader/settings/catalogs/custom-fields/page', () => ({
  default: () => React.createElement('div', null, 'СОДЕРЖИМОЕ:/leader/settings/custom-fields'),
}));
vi.mock('@/app/admin/settings/integrations/page', () => ({
  default: () => React.createElement('div', null, 'СОДЕРЖИМОЕ:/admin/integrations'),
}));
vi.mock('@/app/admin/settings/system/health/page', () => ({
  default: () => React.createElement('div', null, 'СОДЕРЖИМОЕ:/admin/health'),
}));
vi.mock('@/app/admin/settings/access/roles/page', () => ({
  default: () => React.createElement('div', null, 'СОДЕРЖИМОЕ:/admin/roles'),
}));
vi.mock('@/app/leader/settings/access/roles/page', () => ({
  default: () => React.createElement('div', null, 'СОДЕРЖИМОЕ:/leader/roles'),
}));
vi.mock('@/app/admin/settings/integrations/sync/page', () => ({
  default: () => React.createElement('div', null, 'СОДЕРЖИМОЕ:/admin/sync'),
}));
vi.mock('@/app/admin/settings/integrations/1c/excel/page', () => ({
  default: () => React.createElement('div', null, 'СОДЕРЖИМОЕ:/admin/import'),
}));
vi.mock('@/app/admin/settings/integrations/1c/payments/page', () => ({
  default: () => React.createElement('div', null, 'СОДЕРЖИМОЕ:/admin/payments-import'),
}));
vi.mock('@/app/admin/settings/security/audit/page', () => ({
  default: () => React.createElement('div', null, 'СОДЕРЖИМОЕ:/admin/audit'),
}));
vi.mock('@/app/admin/settings/security/personal-data/page', () => ({
  default: () => React.createElement('div', null, 'СОДЕРЖИМОЕ:/admin/pii-access'),
}));

import AdminOrderStatusesLegacyPage from '@/app/admin/order-statuses/page';
import AdminCustomFieldsLegacyPage from '@/app/admin/custom-fields/page';
import LeaderOrderStatusesLegacyPage from '@/app/leader/settings/order-statuses/page';
import LeaderCustomFieldsLegacyPage from '@/app/leader/settings/custom-fields/page';
import AdminIntegrationsLegacyPage from '@/app/admin/integrations/page';
import AdminHealthLegacyPage from '@/app/admin/health/page';
import AdminRolesLegacyPage from '@/app/admin/roles/page';
import LeaderRolesLegacyPage from '@/app/leader/roles/page';
import AdminSyncLegacyPage from '@/app/admin/sync/page';
import AdminImportLegacyPage from '@/app/admin/import/page';
import AdminPaymentsImportLegacyPage from '@/app/admin/payments-import/page';
import AdminAuditLegacyPage from '@/app/admin/audit/page';
import AdminPiiAccessLegacyPage from '@/app/admin/pii-access/page';

beforeEach(() => {
  redirectToSettingsHub.mockReset();
});

describe('шлюзы старых маршрутов настроек', () => {
  it('/admin/order-statuses — свой адрес в редиректе и прежняя страница при выключенном хабе', async () => {
    const { container } = await renderServerComponent(AdminOrderStatusesLegacyPage());
    expect(redirectToSettingsHub).toHaveBeenCalledWith('/admin/order-statuses');
    expect(container.textContent).toContain('СОДЕРЖИМОЕ:/admin/order-statuses');
  });

  it('/admin/custom-fields — свой адрес в редиректе и прежняя страница при выключенном хабе', async () => {
    const { container } = await renderServerComponent(
      AdminCustomFieldsLegacyPage({ searchParams: Promise.resolve({}) } as never)
    );
    expect(redirectToSettingsHub).toHaveBeenCalledWith('/admin/custom-fields');
    expect(container.textContent).toContain('СОДЕРЖИМОЕ:/admin/custom-fields');
  });

  it('/leader/settings/order-statuses — свой адрес в редиректе и прежняя страница при выключенном хабе', async () => {
    const { container } = await renderServerComponent(LeaderOrderStatusesLegacyPage());
    expect(redirectToSettingsHub).toHaveBeenCalledWith('/leader/settings/order-statuses');
    expect(container.textContent).toContain('СОДЕРЖИМОЕ:/leader/settings/order-statuses');
  });

  it('/leader/settings/custom-fields — свой адрес в редиректе и прежняя страница при выключенном хабе', async () => {
    const { container } = await renderServerComponent(
      LeaderCustomFieldsLegacyPage({ searchParams: Promise.resolve({}) } as never)
    );
    expect(redirectToSettingsHub).toHaveBeenCalledWith('/leader/settings/custom-fields');
    expect(container.textContent).toContain('СОДЕРЖИМОЕ:/leader/settings/custom-fields');
  });

  it('/admin/integrations — свой адрес в редиректе и прежняя страница при выключенном хабе', async () => {
    const { container } = await renderServerComponent(AdminIntegrationsLegacyPage());
    expect(redirectToSettingsHub).toHaveBeenCalledWith('/admin/integrations');
    expect(container.textContent).toContain('СОДЕРЖИМОЕ:/admin/integrations');
  });

  it('/admin/health — свой адрес в редиректе и прежняя страница при выключенном хабе', async () => {
    const { container } = await renderServerComponent(AdminHealthLegacyPage());
    expect(redirectToSettingsHub).toHaveBeenCalledWith('/admin/health');
    expect(container.textContent).toContain('СОДЕРЖИМОЕ:/admin/health');
  });

  it('/admin/roles — свой адрес в редиректе и прежняя страница при выключенном хабе', async () => {
    const { container } = await renderServerComponent(AdminRolesLegacyPage());
    expect(redirectToSettingsHub).toHaveBeenCalledWith('/admin/roles');
    expect(container.textContent).toContain('СОДЕРЖИМОЕ:/admin/roles');
  });

  it('/leader/roles — свой адрес в редиректе и прежняя страница при выключенном хабе', async () => {
    const { container } = await renderServerComponent(LeaderRolesLegacyPage());
    expect(redirectToSettingsHub).toHaveBeenCalledWith('/leader/roles');
    expect(container.textContent).toContain('СОДЕРЖИМОЕ:/leader/roles');
  });

  it('/admin/sync — свой адрес в редиректе и прежняя страница при выключенном хабе', async () => {
    const { container } = await renderServerComponent(AdminSyncLegacyPage());
    expect(redirectToSettingsHub).toHaveBeenCalledWith('/admin/sync');
    expect(container.textContent).toContain('СОДЕРЖИМОЕ:/admin/sync');
  });

  it('/admin/import — свой адрес в редиректе и прежняя страница при выключенном хабе', async () => {
    const { container } = await renderServerComponent(AdminImportLegacyPage());
    expect(redirectToSettingsHub).toHaveBeenCalledWith('/admin/import');
    expect(container.textContent).toContain('СОДЕРЖИМОЕ:/admin/import');
  });

  it('/admin/payments-import — свой адрес в редиректе и прежняя страница при выключенном хабе', async () => {
    const { container } = await renderServerComponent(AdminPaymentsImportLegacyPage());
    expect(redirectToSettingsHub).toHaveBeenCalledWith('/admin/payments-import');
    expect(container.textContent).toContain('СОДЕРЖИМОЕ:/admin/payments-import');
  });

  it('/admin/audit — свой адрес в редиректе и прежняя страница при выключенном хабе', async () => {
    const { container } = await renderServerComponent(
      AdminAuditLegacyPage({ searchParams: Promise.resolve({}) } as never)
    );
    expect(redirectToSettingsHub).toHaveBeenCalledWith('/admin/audit');
    expect(container.textContent).toContain('СОДЕРЖИМОЕ:/admin/audit');
  });

  it('/admin/pii-access — свой адрес в редиректе и прежняя страница при выключенном хабе', async () => {
    const { container } = await renderServerComponent(
      AdminPiiAccessLegacyPage({ searchParams: Promise.resolve({}) } as never)
    );
    expect(redirectToSettingsHub).toHaveBeenCalledWith('/admin/pii-access');
    expect(container.textContent).toContain('СОДЕРЖИМОЕ:/admin/pii-access');
  });
});
