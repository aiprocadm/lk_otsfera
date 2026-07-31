// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/components/admin/partner-create-form', () => ({
  PartnerCreateForm: () => React.createElement('div', { 'data-testid': 'partner-create-form' }),
}));

import NewPartnerPage from '@/app/admin/partners/new/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('NewPartnerPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
  });

  it('requires admin and renders the create form', async () => {
    requireAdmin.mockResolvedValue(SESSION);

    const { container } = await renderServerComponent(NewPartnerPage());

    expect(requireAdmin).toHaveBeenCalled();
    expect(container.textContent).toContain('Новый партнёр');
    expect(container.querySelector('[data-testid="partner-create-form"]')).not.toBeNull();
  });
});
