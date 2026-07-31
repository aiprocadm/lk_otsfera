// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listDirections } = vi.hoisted(() => ({ listDirections: vi.fn() }));
vi.mock('@/lib/services/training', () => ({ listDirections }));

vi.mock('@/components/training/directions-admin', () => ({
  DirectionsAdmin: (props: { directions: unknown[] }) =>
    React.createElement(
      'div',
      { 'data-testid': 'directions-admin' },
      JSON.stringify(props.directions)
    ),
}));

import AdminTrainingDirectionsPage from '@/app/admin/training-directions/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminTrainingDirectionsPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    listDirections.mockReset();
  });

  it('renders directions (including inactive) when the service call succeeds', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listDirections.mockResolvedValue({ ok: true, directions: [{ id: 'd1', name: 'Направление' }] });

    const { container } = await renderServerComponent(AdminTrainingDirectionsPage());

    expect(requireAdmin).toHaveBeenCalled();
    expect(listDirections).toHaveBeenCalledWith({}, SESSION, { includeInactive: true });
    expect(container.textContent).toContain('Направление');
  });

  it('falls back to an empty array when the service call fails', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listDirections.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(AdminTrainingDirectionsPage());

    expect(container.textContent).toContain('[]');
  });
});
