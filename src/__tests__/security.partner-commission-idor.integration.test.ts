import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Security regression (Track E / E2-B) — partner commission IDOR at the HTTP
 * route layer + serializer contract.
 *
 * c3 proves the SERVICE (`getStatementWithItems`) rejects a cross-partner id;
 * c2 proves the routes 403 in ORG context. This file closes the remaining gap:
 * a VALID partner session must not reach ANOTHER partner's statement through the
 * real route handlers (404), the finance list serializer must not leak a sibling
 * partner's statement, and the partner-facing JSON must carry no internal-kitchen
 * fields. Only `getSession` is mocked — the routes hit the real DB via the
 * `@/lib/db/prisma` singleton.
 */

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));

import { getSession } from '@/lib/auth/session';
import { GET as financeGET } from '@/app/api/partner/finance/route';
import { GET as statementGET } from '@/app/api/partner/finance/statements/[id]/route';

let prisma: PrismaClient;
const STAMP = Date.now();

let partnerA: string, partnerB: string;
let stmtA: string, stmtB: string;

function partnerSession(partnerId: string): SessionPayload {
  return { sub: `u-${partnerId}`, role: 'partner', partnerId } as unknown as SessionPayload;
}
const req = (url = 'http://x/') => new Request(url);
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  prisma = new PrismaClient();
  const pA = await prisma.partner.create({
    data: { name: `commIdorPA-${STAMP}`, commissionRate: new Prisma.Decimal('0.1') },
  });
  partnerA = pA.id;
  const pB = await prisma.partner.create({
    data: { name: `commIdorPB-${STAMP}`, commissionRate: new Prisma.Decimal('0.2') },
  });
  partnerB = pB.id;

  const sA = await prisma.commissionStatement.create({
    data: {
      partnerId: partnerA,
      periodFrom: new Date('2026-04-01'),
      periodTo: new Date('2026-04-30'),
      totalBaseAmount: 100000,
      averageRate: 0.1,
      totalCommissionAmount: 10000,
      status: 'approved',
    },
  });
  stmtA = sA.id;
  const sB = await prisma.commissionStatement.create({
    data: {
      partnerId: partnerB,
      periodFrom: new Date('2026-04-01'),
      periodTo: new Date('2026-04-30'),
      totalBaseAmount: 200000,
      averageRate: 0.2,
      totalCommissionAmount: 40000,
      status: 'approved',
    },
  });
  stmtB = sB.id;
});

afterAll(async () => {
  await prisma.commissionStatement.deleteMany({
    where: { partnerId: { in: [partnerA, partnerB] } },
  });
  await prisma.partner.deleteMany({ where: { id: { in: [partnerA, partnerB] } } });
  await prisma.$disconnect();
});

describe('E2-B — statement detail route IDOR across partners', () => {
  it('partner B GET partner A statement → 404 (no body served)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession(partnerB));
    const res = await statementGET(req(), idCtx(stmtA));
    expect(res.status).toBe(404);
  });
  it('partner A GET its own statement → 200 (positive control)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession(partnerA));
    const res = await statementGET(req(), idCtx(stmtA));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.statement.id).toBe(stmtA);
  });
});

describe('E2-B — finance list serializer never leaks a sibling partner', () => {
  it('partner A finance list contains own statement, never partner B', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession(partnerA));
    const res = await financeGET(req('http://x/api/partner/finance'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.statements.map((s: { id: string }) => s.id);
    expect(ids).toContain(stmtA); // positive control
    expect(ids).not.toContain(stmtB);
    // Serializer contract: the raw JSON must not carry the sibling partner's id
    // nor any internal-kitchen field name.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(stmtB);
    expect(raw).not.toContain(partnerB);
    for (const forbidden of ['cost', 'себестоим', 'managerId', 'internalComment', 'kpiWeight']) {
      expect(raw.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
  it('symmetry — partner B finance list contains own statement, never partner A', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession(partnerB));
    const res = await financeGET(req('http://x/api/partner/finance'));
    const body = await res.json();
    const ids = body.statements.map((s: { id: string }) => s.id);
    expect(ids).toContain(stmtB);
    expect(ids).not.toContain(stmtA);
  });
});
