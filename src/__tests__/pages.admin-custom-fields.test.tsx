// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listDefinitions } = vi.hoisted(() => ({ listDefinitions: vi.fn() }));
vi.mock('@/lib/services/customFields', () => ({ listDefinitions }));

vi.mock('@/components/admin/custom-fields-admin', () => ({
  CustomFieldsAdmin: (props: { definitions: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'custom-fields-admin' }, JSON.stringify(props.definitions))
}));

import AdminCustomFieldsPage from '@/app/admin/custom-fields/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminCustomFieldsPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    listDefinitions.mockReset();
  });

  it('renders definitions when the service call succeeds', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listDefinitions.mockResolvedValue({ ok: true, rows: [{ id: 'f1', key: 'k1' }] });

    const { container } = await renderServerComponent(AdminCustomFieldsPage());

    expect(requireAdmin).toHaveBeenCalled();
    expect(listDefinitions).toHaveBeenCalledWith({}, SESSION, 'order');
    expect(container.textContent).toContain('f1');
  });

  it('falls back to an empty array when the service call fails', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listDefinitions.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(AdminCustomFieldsPage());

    expect(container.textContent).toContain('[]');
  });
});
