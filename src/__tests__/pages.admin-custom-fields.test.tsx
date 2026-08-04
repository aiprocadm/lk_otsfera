// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listDefinitions } = vi.hoisted(() => ({ listDefinitions: vi.fn() }));
vi.mock('@/lib/services/customFields/definitions', () => ({ listDefinitions }));

vi.mock('@/components/admin/custom-fields-admin', () => ({
  CustomFieldsAdmin: (props: {
    definitions: unknown[];
    entity: string;
    systemFields: { key: string }[];
    basePath: string;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'custom-fields-admin' },
      JSON.stringify({
        definitions: props.definitions,
        entity: props.entity,
        systemKeys: props.systemFields.map((f) => f.key),
        basePath: props.basePath,
      })
    ),
}));

import AdminCustomFieldsPage from '@/app/admin/settings/catalogs/custom-fields/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminCustomFieldsPage', () => {
  beforeEach(() => {
    requireSettingsSection.mockReset();
    listDefinitions.mockReset();
  });

  it('по умолчанию показывает заявку', async () => {
    requireSettingsSection.mockResolvedValue(SESSION);
    listDefinitions.mockResolvedValue({ ok: true, rows: [{ id: 'f1', key: 'k1' }] });

    const { container } = await renderServerComponent(
      AdminCustomFieldsPage({ searchParams: Promise.resolve({}) })
    );

    expect(requireSettingsSection).toHaveBeenCalled();
    expect(listDefinitions).toHaveBeenCalledWith({}, SESSION, 'order');
    expect(container.textContent).toContain('f1');
    expect(container.textContent).toContain('"entity":"order"');
    expect(container.textContent).toContain('"basePath":"/admin/settings/catalogs/custom-fields"');
  });

  it('открывает выбранную сущность и отдаёт её системные поля', async () => {
    requireSettingsSection.mockResolvedValue(SESSION);
    listDefinitions.mockResolvedValue({ ok: true, rows: [] });

    const { container } = await renderServerComponent(
      AdminCustomFieldsPage({ searchParams: Promise.resolve({ entity: 'organization' }) })
    );

    expect(listDefinitions).toHaveBeenCalledWith({}, SESSION, 'organization');
    expect(container.textContent).toContain('"entity":"organization"');
    // §11: пять системных полей организации показываются отдельным блоком
    expect(container.textContent).toContain('assigned_manager');
  });

  it('мусор в адресе не роняет страницу — показывается заявка', async () => {
    requireSettingsSection.mockResolvedValue(SESSION);
    listDefinitions.mockResolvedValue({ ok: true, rows: [] });

    const { container } = await renderServerComponent(
      AdminCustomFieldsPage({ searchParams: Promise.resolve({ entity: 'invoice' }) })
    );

    expect(listDefinitions).toHaveBeenCalledWith({}, SESSION, 'order');
    expect(container.textContent).toContain('"entity":"order"');
  });

  it('отказ сервиса даёт пустой список, а не падение', async () => {
    requireSettingsSection.mockResolvedValue(SESSION);
    listDefinitions.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(
      AdminCustomFieldsPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).toContain('"definitions":[]');
  });
});
