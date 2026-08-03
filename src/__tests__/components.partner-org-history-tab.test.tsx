import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';

import type { PrismaClient } from '@prisma/client';

import { HistoryTab } from '@/components/partner/org-history-tab';

const findMany = vi.fn();
const prisma = { auditLog: { findMany } } as unknown as PrismaClient;

describe('HistoryTab (async server component)', () => {
  beforeEach(() => {
    findMany.mockReset();
  });

  it('shows the empty-state message when there is no history', async () => {
    findMany.mockResolvedValue([]);
    const element = await HistoryTab({ orgId: 'org1', prisma });
    const html = renderToString(element);
    expect(html).toContain('История пуста.');
  });

  it('renders a known action with its Russian label and "Система" when user is null', async () => {
    findMany.mockResolvedValue([
      {
        id: 'a1',
        action: 'partner_commission_rate_changed',
        createdAt: new Date('2026-01-01'),
        user: null,
        meta: null,
      },
    ]);
    const element = await HistoryTab({ orgId: 'org1', prisma });
    const html = renderToString(element);
    expect(html).toContain('Изменена ставка комиссии');
    expect(html).toContain('Система');
  });

  it('renders the actor name when user is present', async () => {
    findMany.mockResolvedValue([
      {
        id: 'a1',
        action: 'partner_commission_rate_changed',
        createdAt: new Date('2026-01-01'),
        user: { name: 'Админ Иванов' },
        meta: null,
      },
    ]);
    const element = await HistoryTab({ orgId: 'org1', prisma });
    const html = renderToString(element);
    expect(html).toContain('Админ Иванов');
  });

  it('falls back to the raw action string for an unknown action', async () => {
    findMany.mockResolvedValue([
      {
        id: 'a1',
        action: 'some_other_action',
        createdAt: new Date('2026-01-01'),
        user: null,
        meta: null,
      },
    ]);
    const element = await HistoryTab({ orgId: 'org1', prisma });
    const html = renderToString(element);
    expect(html).toContain('some_other_action');
  });

  it('shows oldRate/newRate meta for the rate-changed action, with em-dash fallback when oldRate is absent', async () => {
    findMany.mockResolvedValue([
      {
        id: 'a1',
        action: 'partner_commission_rate_changed',
        createdAt: new Date('2026-01-01'),
        user: null,
        meta: { oldRate: null, newRate: '0.08' },
      },
    ]);
    const element = await HistoryTab({ orgId: 'org1', prisma });
    const html = renderToString(element);
    expect(html).toContain('—');
    expect(html).toContain('0.08');
  });

  it('falls back to em-dash for newRate when it is absent too', async () => {
    findMany.mockResolvedValue([
      {
        id: 'a1',
        action: 'partner_commission_rate_changed',
        createdAt: new Date('2026-01-01'),
        user: null,
        meta: { oldRate: '0.05', newRate: null },
      },
    ]);
    const element = await HistoryTab({ orgId: 'org1', prisma });
    const html = renderToString(element);
    expect(html).toContain('0.05');
    expect(html).toMatch(/0\.05.*—/);
  });

  it('shows the reason suffix when meta.reason is present', async () => {
    findMany.mockResolvedValue([
      {
        id: 'a1',
        action: 'partner_commission_rate_changed',
        createdAt: new Date('2026-01-01'),
        user: null,
        meta: { oldRate: '0.1', newRate: '0.08', reason: 'VIP-клиент' },
      },
    ]);
    const element = await HistoryTab({ orgId: 'org1', prisma });
    const html = renderToString(element);
    expect(html).toContain('VIP-клиент');
  });

  it('does not render the meta detail span when meta is falsy, even for the rate-changed action', async () => {
    findMany.mockResolvedValue([
      {
        id: 'a1',
        action: 'partner_commission_rate_changed',
        createdAt: new Date('2026-01-01'),
        user: null,
        meta: null,
      },
    ]);
    const element = await HistoryTab({ orgId: 'org1', prisma });
    const html = renderToString(element);
    expect(html).not.toContain('text-gray-500 text-xs ml-2');
  });

  it('queries by entity Organization + entityId, ordered desc, take 50', async () => {
    findMany.mockResolvedValue([]);
    await HistoryTab({ orgId: 'org42', prisma });
    expect(findMany).toHaveBeenCalledWith({
      where: { entity: 'Organization', entityId: 'org42' },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });
});
