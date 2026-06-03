import { describe, it, expect, vi, beforeEach } from 'vitest';
const { notifyManagers, notifyOrgUsers } = vi.hoisted(() => ({ notifyManagers: vi.fn(), notifyOrgUsers: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ notifyManagers, notifyOrgUsers }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: vi.fn() }));
import { sendMessage } from '@/lib/services/chat/messages';

const order = { id: 'o1', organizationId: 'org1', partnerId: 'p1', orderNumber: 'N1', title: 'T' };
function prismaMock() {
  return {
    order: { findUnique: vi.fn().mockResolvedValue(order) },
    orderThread: { upsert: vi.fn().mockResolvedValue({ id: 't1', side: 'org', orderId: 'o1' }) },
    message: { create: vi.fn().mockResolvedValue({ id: 'm1' }) }
  } as any;
}
const orgSession = { sub: 'u', role: 'organization', organizationMemberships: [{ organizationId: 'org1', isActive: true, roleInOrg: 'member' }] } as any;
const teamSession = { sub: 'mgr1', role: 'manager' } as any;

beforeEach(() => { notifyManagers.mockReset(); notifyOrgUsers.mockReset(); });

describe('sendMessage', () => {
  it('rejects empty body', async () => {
    expect(await sendMessage(prismaMock(), orgSession, { orderId: 'o1', side: 'org', body: '   ' })).toEqual({ ok: false, error: 'empty_body' });
  });
  it('rejects too-long body', async () => {
    expect(await sendMessage(prismaMock(), orgSession, { orderId: 'o1', side: 'org', body: 'x'.repeat(5001) })).toEqual({ ok: false, error: 'too_large' });
  });
  it('org author succeeds and notifies managers', async () => {
    const r = await sendMessage(prismaMock(), orgSession, { orderId: 'o1', side: 'org', body: 'hi' });
    expect(r).toEqual({ ok: true, messageId: 'm1' });
    expect(notifyManagers).toHaveBeenCalled();
  });
  it('team (manager) on org side notifies org users', async () => {
    const r = await sendMessage(prismaMock(), teamSession, { orderId: 'o1', side: 'org', body: 'reply' });
    expect(r.ok).toBe(true);
    expect(notifyOrgUsers).toHaveBeenCalled();
  });
  it('forbidden when partner writes org side', async () => {
    const partner = { sub: 'pu', role: 'partner', partnerId: 'p1' } as any;
    expect(await sendMessage(prismaMock(), partner, { orderId: 'o1', side: 'org', body: 'hi' })).toEqual({ ok: false, error: 'forbidden' });
  });
  it('order_not_found', async () => {
    const pm = prismaMock(); pm.order.findUnique.mockResolvedValue(null);
    expect(await sendMessage(pm, teamSession, { orderId: 'x', side: 'org', body: 'hi' })).toEqual({ ok: false, error: 'order_not_found' });
  });

  // FIX 1: IDOR — attacker-controlled attachmentPath guard
  it('attachmentPath referencing another order → forbidden (IDOR guard)', async () => {
    // orderId is 'o1'; attacker tries to reference another order's document
    expect(
      await sendMessage(prismaMock(), orgSession, {
        orderId: 'o1',
        side: 'org',
        body: 'see attachment',
        attachmentPath: 'orders/victim-order-id/secret.pdf'
      })
    ).toEqual({ ok: false, error: 'forbidden' });
  });

  it('attachmentPath with correct chat/<orderId>/ prefix → ok', async () => {
    const result = await sendMessage(prismaMock(), orgSession, {
      orderId: 'o1',
      side: 'org',
      body: 'see attachment',
      attachmentPath: 'chat/o1/uuid-file.pdf'
    });
    expect(result).toEqual({ ok: true, messageId: 'm1' });
  });

  it('attachmentPath with chat/ prefix but wrong orderId → forbidden', async () => {
    expect(
      await sendMessage(prismaMock(), orgSession, {
        orderId: 'o1',
        side: 'org',
        body: 'see attachment',
        attachmentPath: 'chat/other-order/uuid-file.pdf'
      })
    ).toEqual({ ok: false, error: 'forbidden' });
  });
});
