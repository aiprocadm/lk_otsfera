import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { updateOneCDocumentPushRule } from '@/lib/services/admin/oneCDocumentPushRule';
import { listCompaniesRequisites } from '@/lib/services/admin/companyRequisites';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Этап 8 PR-4 (`У-169`) — правило выгрузки в 1С на живом Postgres: умолчание
 * компании «только по кнопке» со всеми четырьмя типами (спека §2), запись
 * руководителем своей компании и чтение тем же экраном (`listCompaniesRequisites`),
 * чужая компания недоступна, КП отсекается кодом ДО проверки базы, событие
 * аудита с «было/стало».
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyA: string;
let companyB: string;
let leader: string;

const sLeader = (): SessionPayload =>
  ({ sub: leader, role: 'leader', companyId: companyA }) as unknown as SessionPayload;

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `s8p4-A-${STAMP}` } })).id;
  companyB = (await prisma.company.create({ data: { name: `s8p4-B-${STAMP}` } })).id;
  leader = (
    await prisma.user.create({
      data: { email: `s8p4-l-${STAMP}@t.local`, name: 'Р', role: 'leader', companyId: companyA },
    })
  ).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: leader } });
  await prisma.user.deleteMany({ where: { id: leader } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('правило выгрузки в 1С (У-169)', () => {
  it('новая компания: «только по кнопке» и все четыре типа — ничего не уезжает молча', async () => {
    const res = await listCompaniesRequisites(prisma, sLeader());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.companies.map((c) => c.id)).toEqual([companyA]);
    expect(res.companies[0]).toMatchObject({
      oneCDocumentPushMode: 'manual',
      oneCDocumentPushTypes: ['invoice', 'act', 'contract', 'extra_agreement'],
    });
  });

  it('руководитель сохраняет правило своей компании; экран читает его обратно; аудит с «было/стало»', async () => {
    expect(
      await updateOneCDocumentPushRule(prisma, sLeader(), companyA, {
        mode: 'auto',
        types: ['act', 'invoice'],
      })
    ).toEqual({ ok: true });

    const res = await listCompaniesRequisites(prisma, sLeader());
    expect(res.ok && res.companies[0]).toMatchObject({
      oneCDocumentPushMode: 'auto',
      // Канонический порядок, а не порядок формы.
      oneCDocumentPushTypes: ['invoice', 'act'],
    });

    const audit = await prisma.auditLog.findFirst({
      where: { userId: leader, action: 'company_onec_push_rule_changed', entityId: companyA },
      select: { entity: true, meta: true },
    });
    expect(audit?.entity).toBe('company');
    expect(audit?.meta).toMatchObject({
      before: { mode: 'manual', types: ['invoice', 'act', 'contract', 'extra_agreement'] },
      after: { mode: 'auto', types: ['invoice', 'act'] },
    });
  });

  it('чужая компания руководителю недоступна — правило не меняется', async () => {
    expect(
      await updateOneCDocumentPushRule(prisma, sLeader(), companyB, { mode: 'never', types: [] })
    ).toEqual({ ok: false, error: 'forbidden' });
    const row = await prisma.company.findUnique({
      where: { id: companyB },
      select: { oneCDocumentPushMode: true },
    });
    expect(row?.oneCDocumentPushMode).toBe('manual');
  });

  it('КП в наборе отсекается кодом — до проверки базы (CHECK не срабатывает)', async () => {
    expect(
      await updateOneCDocumentPushRule(prisma, sLeader(), companyA, {
        mode: 'auto',
        types: ['invoice', 'commercial_proposal'],
      })
    ).toEqual({ ok: false, error: 'invalid_types' });
    // База тоже держит инвариант — прямой обход кода упирается в CHECK.
    await expect(
      prisma.company.update({
        where: { id: companyA },
        data: { oneCDocumentPushTypes: ['commercial_proposal'] },
      })
    ).rejects.toThrow(/Company_oneCDocumentPushTypes_pushable|check constraint/i);
  });
});
