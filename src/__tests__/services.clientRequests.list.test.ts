/**
 * Unit tests for src/lib/services/clientRequests/list.ts (этап 5, Модуль 1).
 *
 * clientRequestScopeWhere — C8-скоуп очереди (компания + общая очередь,
 * sentinel '__none__' у менеджера без companyId, submittedByUserId для
 * клиентских ролей); listClientRequests — фильтр статуса, keyset-пагинация
 * take+1, PII-журнал; getClientRequest — not_found вне скоупа, маппинг toRow.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import {
  clientRequestScopeWhere,
  listClientRequests,
  getClientRequest,
} from '@/lib/services/clientRequests/list';

// ─── helpers ──────────────────────────────────────────────────────────────────

const s = (over: Partial<SessionPayload> = {}): SessionPayload =>
  ({ sub: 'u1', role: 'manager', ...over }) as SessionPayload;

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  source: 'partner_cabinet',
  companyName: 'ООО Ромашка',
  inn: '7712345678',
  contactName: 'Иван Иванов',
  contactPhone: '+79000000000',
  contactEmail: 'i@x.ru',
  subject: 'Обучение',
  body: 'Текст',
  status: 'submitted',
  organizationId: null,
  rejectedReason: null,
  createdAt: new Date('2026-01-10T00:00:00Z'),
  triagedAt: null,
  submittedByUser: { name: 'Податель' },
  partner: { name: 'Партнёр' },
  organization: null,
  convertedLead: null,
  _count: { attachments: 0 },
  ...over,
});

function db(rows: unknown[] = []) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const findFirst = vi.fn().mockResolvedValue(rows[0] ?? null);
  return { prisma: { clientRequest: { findMany, findFirst } } as never, findMany, findFirst };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── clientRequestScopeWhere ──────────────────────────────────────────────────

describe('clientRequestScopeWhere', () => {
  it('admin видит всё (пустой where)', () => {
    expect(clientRequestScopeWhere(s({ role: 'admin' }))).toEqual({});
  });

  it('manager: OR — организации своей компании + общая очередь (organizationId=null)', () => {
    expect(clientRequestScopeWhere(s({ role: 'manager', companyId: 'c1' }))).toEqual({
      OR: [{ organization: { companyId: 'c1' } }, { organizationId: null }],
    });
  });

  it('leader — тот же manager-скоуп', () => {
    expect(
      clientRequestScopeWhere(s({ role: 'manager', managerRole: 'leader', companyId: 'c1' }))
    ).toEqual({
      OR: [{ organization: { companyId: 'c1' } }, { organizationId: null }],
    });
  });

  it("manager без companyId → sentinel '__none__' (только общая очередь)", () => {
    expect(clientRequestScopeWhere(s({ role: 'manager', companyId: null }))).toEqual({
      OR: [{ organization: { companyId: '__none__' } }, { organizationId: null }],
    });
  });

  it('клиентские роли (partner/organization/student) видят только свои заявки', () => {
    for (const role of ['partner', 'organization', 'student'] as const) {
      expect(clientRequestScopeWhere(s({ role, sub: 'me' }))).toEqual({ submittedByUserId: 'me' });
    }
  });
});

// ─── listClientRequests ───────────────────────────────────────────────────────

describe('listClientRequests', () => {
  it('скоуп в AND[0]; без статуса — фильтра статуса нет; дефолт take=20 → take 21', async () => {
    const { prisma, findMany } = db();
    await listClientRequests(prisma, s({ role: 'admin' }));
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({ AND: [{}] });
    expect(args.take).toBe(21);
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(args.cursor).toBeUndefined();
  });

  it('фильтр статуса добавляется в AND', async () => {
    const { prisma, findMany } = db();
    await listClientRequests(prisma, s({ role: 'admin' }), { status: 'in_triage' });
    expect(findMany.mock.calls[0][0].where).toEqual({ AND: [{}, { status: 'in_triage' }] });
  });

  it('пагинация: запрашивает take+1; при переполнении режет страницу и отдаёт nextCursor', async () => {
    const { prisma, findMany } = db([row('R1'), row('R2'), row('R3')]);
    const res = await listClientRequests(prisma, s({ role: 'admin' }), { take: 2 });
    expect(findMany.mock.calls[0][0].take).toBe(3);
    expect(res.rows.map((r) => r.id)).toEqual(['R1', 'R2']);
    expect(res.nextCursor).toBe('R2');
  });

  it('cursor пробрасывается с skip:1; последняя страница → nextCursor=null', async () => {
    const { prisma, findMany } = db([row('R3')]);
    const res = await listClientRequests(prisma, s({ role: 'admin' }), { take: 2, cursor: 'R2' });
    expect(findMany.mock.calls[0][0]).toMatchObject({ cursor: { id: 'R2' }, skip: 1 });
    expect(res.rows.map((r) => r.id)).toEqual(['R3']);
    expect(res.nextCursor).toBeNull();
  });

  it('PII-журнал: context=client_requests_list, subjectIds — только страница (без take+1 хвоста)', async () => {
    const { prisma } = db([row('R1'), row('R2'), row('R3')]);
    const session = s({ role: 'manager', companyId: 'c1' });
    await listClientRequests(prisma, session, { take: 2, cursor: 'R0' });
    expect(recordPiiAccess).toHaveBeenCalledWith(prisma, {
      session,
      context: 'client_requests_list',
      subjectIds: ['R1', 'R2'],
      meta: { take: 2, cursor: true },
    });
  });
});

// ─── getClientRequest ─────────────────────────────────────────────────────────

describe('getClientRequest', () => {
  it('вне скоупа/несуществующая → not_found (без PII-журнала)', async () => {
    const { prisma, findFirst } = db([]);
    expect(await getClientRequest(prisma, s({ role: 'manager', companyId: 'c1' }), 'RX')).toEqual({
      ok: false,
      error: 'not_found',
    });
    // Сам скоуп зашит в запрос: чужая заявка неотличима от несуществующей.
    expect(findFirst.mock.calls[0][0].where).toEqual({
      AND: [
        { id: 'RX' },
        { OR: [{ organization: { companyId: 'c1' } }, { organizationId: null }] },
      ],
    });
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });

  it('маппинг toRow: имена связей, attachmentCount из _count, convertedLeadId', async () => {
    const src = row('R1', {
      status: 'converted',
      organizationId: 'o1',
      organization: { name: 'Орг А' },
      convertedLead: { id: 'L1' },
      triagedAt: new Date('2026-01-11T00:00:00Z'),
      _count: { attachments: 3 },
    });
    const { prisma } = db([src]);
    const r = await getClientRequest(prisma, s({ role: 'admin' }), 'R1');
    if (!r.ok) throw new Error('expected ok');
    expect(r.request).toEqual({
      id: 'R1',
      source: 'partner_cabinet',
      companyName: 'ООО Ромашка',
      inn: '7712345678',
      contactName: 'Иван Иванов',
      contactPhone: '+79000000000',
      contactEmail: 'i@x.ru',
      subject: 'Обучение',
      body: 'Текст',
      status: 'converted',
      submittedByName: 'Податель',
      partnerName: 'Партнёр',
      organizationName: 'Орг А',
      organizationId: 'o1',
      rejectedReason: null,
      createdAt: new Date('2026-01-10T00:00:00Z'),
      triagedAt: new Date('2026-01-11T00:00:00Z'),
      attachmentCount: 3,
    });
  });

  it('нулевые связи: partnerName/organizationName/convertedLeadId → null; PII-журнал view', async () => {
    const { prisma } = db([row('R2', { partner: null })]);
    const session = s({ role: 'admin' });
    const r = await getClientRequest(prisma, session, 'R2');
    if (!r.ok) throw new Error('expected ok');
    expect(r.request).toMatchObject({
      partnerName: null,
      organizationName: null,
      attachmentCount: 0,
    });
    expect(recordPiiAccess).toHaveBeenCalledWith(prisma, {
      session,
      context: 'client_request_view',
      subjectIds: ['R2'],
    });
  });
});
