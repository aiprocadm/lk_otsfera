import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';

/**
 * `У-98`/`У-100`: «Доступ в кабинет» переехал из отдельного пункта меню на
 * вкладку «Настройки» своей организации. Экран тот же — список участников,
 * приглашение, роли, — поэтому проверяем, что права на управление сохранились
 * ровно те же: приглашать могут администратор и руководитель, участник — нет.
 */
const { listMembers } = vi.hoisted(() => ({ listMembers: vi.fn() }));
vi.mock('@/lib/services/organization/team', () => ({ listMembers }));

vi.mock('@/components/organization/team-table', () => ({
  TeamTable: (p: { members: Array<{ name: string }>; viewerRole: string }) =>
    React.createElement('div', null, `СПИСОК:${p.members.length}:${p.viewerRole}`),
}));
vi.mock('@/components/organization/invite-org-user-form', () => ({
  InviteOrgUserForm: () => React.createElement('div', null, 'ПРИГЛАСИТЬ'),
}));

import type { PrismaClient } from '@prisma/client';
import { OrgCabinetAccessSection } from '@/components/organization/org-cabinet-access-section';

const prisma = {} as PrismaClient;

beforeEach(() => {
  vi.clearAllMocks();
  listMembers.mockResolvedValue([{ name: 'Анна' }, { name: 'Борис' }]);
});

async function render(viewerRole: 'admin' | 'leader' | 'member') {
  return renderToString(
    await OrgCabinetAccessSection({
      organizationId: 'org-1',
      prisma,
      currentUserId: 'u1',
      viewerRole,
    })
  );
}

describe('OrgCabinetAccessSection (У-98, У-100)', () => {
  it('администратор организации может пригласить', async () => {
    expect(await render('admin')).toContain('ПРИГЛАСИТЬ');
  });

  it('руководитель организации тоже может', async () => {
    expect(await render('leader')).toContain('ПРИГЛАСИТЬ');
  });

  it('участник видит список, но кнопки приглашения не получает', async () => {
    const html = await render('member');
    expect(html).toContain('СПИСОК:2:member');
    expect(html).not.toContain('ПРИГЛАСИТЬ');
  });

  it('своего заголовка не рисует — название даёт реестр секций', async () => {
    expect(await render('admin')).not.toContain('<h2');
  });

  it('правила ролей объяснены прямо на экране (§15)', async () => {
    const html = await render('admin');
    expect(html).toContain('Последнего активного');
  });
});
