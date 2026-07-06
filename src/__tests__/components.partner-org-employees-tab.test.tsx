import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { organizationUser: { findMany } } }));

import { EmployeesTab } from '@/components/partner/org-employees-tab';

describe('EmployeesTab (async server component)', () => {
  beforeEach(() => {
    findMany.mockReset();
  });

  it('shows the empty-state message when there are no employees', async () => {
    findMany.mockResolvedValue([]);
    const element = await EmployeesTab({ orgId: 'org1' });
    const html = renderToString(element);
    expect(html).toContain('В этой организации пока нет сотрудников.');
  });

  it('renders each employee with name, email and role badge when roleInOrg is set', async () => {
    findMany.mockResolvedValue([
      { id: 'ou1', roleInOrg: 'admin', user: { name: 'Анна Смирнова', email: 'anna@x.com' } }
    ]);
    const element = await EmployeesTab({ orgId: 'org1' });
    const html = renderToString(element);
    expect(html).toContain('Анна Смирнова');
    expect(html).toContain('anna@x.com');
    expect(html).toContain('admin');
  });

  it('omits the role badge when roleInOrg is null/falsy', async () => {
    findMany.mockResolvedValue([
      { id: 'ou2', roleInOrg: null, user: { name: 'Без роли', email: 'norole@x.com' } }
    ]);
    const element = await EmployeesTab({ orgId: 'org1' });
    const html = renderToString(element);
    expect(html).toContain('Без роли');
    expect(html).not.toContain('bg-gray-50 px-2 py-1 rounded');
  });

  it('queries only active employees for the given orgId, ordered by createdAt asc', async () => {
    findMany.mockResolvedValue([]);
    await EmployeesTab({ orgId: 'org42' });
    expect(findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org42', isActive: true },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'asc' }
    });
  });
});
