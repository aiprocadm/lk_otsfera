import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listOrgOrderComments } = vi.hoisted(() => ({ listOrgOrderComments: vi.fn() }));
vi.mock('@/lib/services/partner/orgComments', () => ({ listOrgOrderComments }));

import { CommentsTab } from '@/components/partner/org-comments-tab';
import type { OrgCommentRow } from '@/lib/services/partner/orgComments';

function makeComment(overrides: Partial<OrgCommentRow> = {}): OrgCommentRow {
  return {
    id: 'c1',
    body: 'Нужен акт по заказу',
    createdAt: new Date('2026-02-10T10:30:00Z'),
    authorName: 'Иван Петров',
    orderId: 'ord1',
    orderTitle: 'Обучение №42',
    ...overrides
  };
}

describe('CommentsTab (async server component)', () => {
  beforeEach(() => {
    listOrgOrderComments.mockReset();
  });

  it('shows the empty-state message when there are no comments', async () => {
    listOrgOrderComments.mockResolvedValue([]);
    const element = await CommentsTab({ orgId: 'org1' });
    const html = renderToString(element);
    expect(html).toContain('Комментариев нет.');
  });

  it('renders each comment with author, order title, timestamp and body', async () => {
    listOrgOrderComments.mockResolvedValue([makeComment()]);
    const element = await CommentsTab({ orgId: 'org1' });
    const html = renderToString(element);
    expect(html).toContain('Иван Петров');
    expect(html).toContain('Обучение №42');
    expect(html).toContain('Нужен акт по заказу');
  });

  it('forwards orgId to listOrgOrderComments', async () => {
    listOrgOrderComments.mockResolvedValue([]);
    await CommentsTab({ orgId: 'org42' });
    expect(listOrgOrderComments).toHaveBeenCalledWith({}, { orgId: 'org42' });
  });

  it('renders multiple comments in order returned by the service', async () => {
    listOrgOrderComments.mockResolvedValue([
      makeComment({ id: 'c1', body: 'Первый' }),
      makeComment({ id: 'c2', body: 'Второй' })
    ]);
    const element = await CommentsTab({ orgId: 'org1' });
    const html = renderToString(element);
    expect(html).toContain('Первый');
    expect(html).toContain('Второй');
  });
});
