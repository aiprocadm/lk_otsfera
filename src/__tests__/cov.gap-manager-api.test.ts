/**
 * Добор покрытия по группе «manager-api»: ветки, которые не задевались ни
 * unit-, ни integration-тестами.
 *
 * Закрываем четыре сюжета:
 *  1. Кривое тело запроса → `parseJsonBody` возвращает `{ ok: false }`, роут
 *     отдаёт готовый 400 `invalid_request` и НЕ зовёт сервис (CLAUDE.md §3:
 *     Zod в роуте проверяет только форму входа).
 *  2. Необязательное поле `note` в POST /api/manager/orders/[id]/items —
 *     ветка условного спреда «поле передали» (exactOptionalPropertyTypes).
 *  3. Необязательный `validUntil` в POST /api/manager/certificates — ветка
 *     «срок указан» на обоих путях выпуска (из позиции заказа и вручную).
 *  4. Ветка `!res.ok` у action=reject в PATCH /api/manager/leads/[id].
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/requireRole', () => ({ requireManager: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/training/orderItems', () => ({
  addOrderItem: vi.fn(),
  listOrderItems: vi.fn(),
  updateItemStatus: vi.fn(),
  removeOrderItem: vi.fn(),
}));
vi.mock('@/lib/services/training/certificates', () => ({
  createCertificate: vi.fn(),
  issueFromOrderItem: vi.fn(),
}));
vi.mock('@/lib/services/manager/leads', () => ({
  listManagerLeads: vi.fn(),
  getManagerLead: vi.fn(),
}));
vi.mock('@/lib/services/manager/leadLifecycle', () => ({
  assignLead: vi.fn(),
  setLeadStatus: vi.fn(),
  promoteLead: vi.fn(),
  rejectLead: vi.fn(),
}));

import { requireManager } from '@/lib/auth/requireRole';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { addOrderItem, updateItemStatus } from '@/lib/services/training/orderItems';
import { createCertificate, issueFromOrderItem } from '@/lib/services/training/certificates';
import {
  assignLead,
  setLeadStatus,
  promoteLead,
  rejectLead,
} from '@/lib/services/manager/leadLifecycle';
import { POST as itemsPost } from '@/app/api/manager/orders/[id]/items/route';
import { PATCH as itemPatch } from '@/app/api/manager/order-items/[id]/route';
import { POST as certPost } from '@/app/api/manager/certificates/route';
import { PATCH as leadPatch } from '@/app/api/manager/leads/[id]/route';

const session = { sub: 'm1', role: 'manager', email: 'm@local', companyId: 'c1' } as never;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

/** Запрос с телом-строкой: сюда кладём и валидный JSON, и заведомо битый. */
const req = (method: string, rawBody: string) =>
  new Request('http://x/', {
    method,
    body: rawBody,
    headers: { 'content-type': 'application/json' },
  }) as never;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireManager).mockResolvedValue(session);
  vi.mocked(notFoundIfDisabled).mockReturnValue(undefined as never);
});

describe('Кривое тело запроса → 400 invalid_request до вызова сервиса', () => {
  it('POST /api/manager/orders/[id]/items: studentId не строка', async () => {
    const res = await itemsPost(
      req('POST', JSON.stringify({ studentId: 7, directionId: 'd1' })),
      ctx('o1')
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_request' });
    expect(vi.mocked(addOrderItem)).not.toHaveBeenCalled();
  });

  it('PATCH /api/manager/order-items/[id]: тело — не JSON вовсе', async () => {
    const res = await itemPatch(req('PATCH', 'это не json'), ctx('it1'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_request' });
    expect(vi.mocked(updateItemStatus)).not.toHaveBeenCalled();
  });

  it('POST /api/manager/certificates: нет обязательных number/issuedAt', async () => {
    const res = await certPost(req('POST', JSON.stringify({ orderItemId: 'oi1' })));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_request' });
    expect(vi.mocked(issueFromOrderItem)).not.toHaveBeenCalled();
    expect(vi.mocked(createCertificate)).not.toHaveBeenCalled();
  });

  it('PATCH /api/manager/leads/[id]: action не строка', async () => {
    const res = await leadPatch(req('PATCH', JSON.stringify({ action: 42 })), ctx('l1'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_request' });
    expect(vi.mocked(assignLead)).not.toHaveBeenCalled();
    expect(vi.mocked(setLeadStatus)).not.toHaveBeenCalled();
    expect(vi.mocked(promoteLead)).not.toHaveBeenCalled();
    expect(vi.mocked(rejectLead)).not.toHaveBeenCalled();
  });
});

describe('POST /api/manager/orders/[id]/items — необязательное поле note', () => {
  it('переданный note доходит до сервиса', async () => {
    vi.mocked(addOrderItem).mockResolvedValue({ ok: true, item: { id: 'it1' } } as never);
    const res = await itemsPost(
      req('POST', JSON.stringify({ studentId: 's1', directionId: 'd1', note: 'группа вечерняя' })),
      ctx('o1')
    );
    expect(res.status).toBe(201);
    expect(vi.mocked(addOrderItem)).toHaveBeenCalledWith({}, session, {
      orderId: 'o1',
      studentId: 's1',
      directionId: 'd1',
      note: 'группа вечерняя',
    });
  });

  it('без note ключ в аргументах сервиса отсутствует', async () => {
    vi.mocked(addOrderItem).mockResolvedValue({ ok: true, item: { id: 'it2' } } as never);
    await itemsPost(req('POST', JSON.stringify({ studentId: 's1', directionId: 'd1' })), ctx('o1'));
    const args = vi.mocked(addOrderItem).mock.calls[0][2];
    expect(Object.prototype.hasOwnProperty.call(args, 'note')).toBe(false);
  });
});

describe('POST /api/manager/certificates — необязательный срок действия', () => {
  it('validUntil переданный вместе с orderItemId превращается в дату', async () => {
    vi.mocked(issueFromOrderItem).mockResolvedValue({
      ok: true,
      certificate: { id: 'c1' },
    } as never);
    const res = await certPost(
      req(
        'POST',
        JSON.stringify({
          orderItemId: 'oi1',
          number: 'CERT-010',
          issuedAt: '2026-01-01',
          validUntil: '2027-01-01',
          documentId: 'doc-1',
        })
      )
    );
    expect(res.status).toBe(201);
    expect(vi.mocked(issueFromOrderItem)).toHaveBeenCalledWith(
      {},
      session,
      expect.objectContaining({
        validUntil: new Date('2027-01-01'),
        documentId: 'doc-1',
      })
    );
  });

  it('validUntil в ручном выпуске (без orderItemId) тоже превращается в дату', async () => {
    vi.mocked(createCertificate).mockResolvedValue({
      ok: true,
      certificate: { id: 'c2' },
    } as never);
    const res = await certPost(
      req(
        'POST',
        JSON.stringify({
          studentId: 's1',
          directionId: 'd1',
          number: 'CERT-011',
          issuedAt: '2026-01-01',
          validUntil: '2027-06-30',
          comment: 'выдан вручную',
        })
      )
    );
    expect(res.status).toBe(201);
    expect(vi.mocked(createCertificate)).toHaveBeenCalledWith(
      {},
      session,
      expect.objectContaining({
        validUntil: new Date('2027-06-30'),
        comment: 'выдан вручную',
        documentId: null,
      })
    );
  });
});

describe('PATCH /api/manager/leads/[id] — отказ по лиду', () => {
  it('нарушение жизненного цикла при reject → 409 и код ошибки в теле', async () => {
    vi.mocked(rejectLead).mockResolvedValue({ ok: false, error: 'lifecycle_violation' } as never);
    const res = await leadPatch(
      req('PATCH', JSON.stringify({ action: 'reject', reason: 'клиент передумал' })),
      ctx('l1')
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'lifecycle_violation' });
    expect(vi.mocked(rejectLead)).toHaveBeenCalledWith(
      {},
      { leadId: 'l1', managerId: 'm1', reason: 'клиент передумал' }
    );
  });
});
