/**
 * Страж `У-62` (этап 4 ТЗ понятности): реквизиты организации ведёт партнёр —
 * но **только администратор** и **только своей** организации.
 *
 * До этапа сервис пускал исключительно пользователей организации, партнёру
 * отвечал `forbidden`. Расширение прав — самая опасная часть этапа: реквизиты
 * идут в документы, поэтому обе отказные ветки закрыты тестом, а не «скрытой
 * формой» (§4: скрытая кнопка — это внешний вид, а не защита).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAuditMock } = vi.hoisted(() => ({ recordAuditMock: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));

import { getOrgRequisites, setOrgRequisites } from '@/lib/services/organization/requisites';

const ORG_ID = 'org-1';

const partner = (
  partnerRole: 'admin' | 'manager',
  extra: Partial<SessionPayload> = {}
): SessionPayload =>
  ({ sub: 'pu1', role: 'partner', partnerId: 'pt-1', partnerRole, ...extra }) as SessionPayload;

const VALUES = {
  legalName: 'ООО Ромашка',
  inn: '7707083893',
  kpp: '',
  ogrn: '',
  legalAddress: '',
  bankName: '',
  bankAccount: '',
  corrAccount: '',
  bic: '',
  signerName: '',
  signerPosition: '',
  signerBasis: '',
};

/** Призма-двойник: `findFirst` решает «организация в портфеле партнёра». */
function makePrisma(opts: { inPortfolio: boolean }) {
  const update = vi.fn().mockResolvedValue({});
  return {
    prisma: {
      organization: {
        findFirst: vi.fn().mockResolvedValue(opts.inPortfolio ? { id: ORG_ID } : null),
        findUnique: vi.fn().mockResolvedValue({ name: 'Ромашка', ...VALUES }),
        update,
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ organization: { update }, auditLog: { create: vi.fn() } })
      ),
    } as unknown as PrismaClient,
    update,
  };
}

beforeEach(() => {
  recordAuditMock.mockReset();
});

describe('У-62: партнёр и реквизиты организации', () => {
  it('партнёр-администратор своей организации читает реквизиты', async () => {
    const { prisma } = makePrisma({ inPortfolio: true });

    const res = await getOrgRequisites(prisma, partner('admin'), ORG_ID);

    expect(res.ok).toBe(true);
  });

  it('обычный партнёрский пользователь читать может', async () => {
    const { prisma } = makePrisma({ inPortfolio: true });

    const res = await getOrgRequisites(prisma, partner('manager'), ORG_ID);

    expect(res.ok).toBe(true);
  });

  it('партнёр-администратор своей организации меняет реквизиты', async () => {
    const { prisma, update } = makePrisma({ inPortfolio: true });

    const res = await setOrgRequisites(prisma, partner('admin'), ORG_ID, VALUES);

    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalled();
  });

  // ── отказные ветки: обе обязаны не только вернуть forbidden, но и не писать ──
  it('обычный партнёрский пользователь получает forbidden и НЕ пишет', async () => {
    const { prisma, update } = makePrisma({ inPortfolio: true });

    const res = await setOrgRequisites(prisma, partner('manager'), ORG_ID, VALUES);

    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(update).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it('партнёр чужой организации получает forbidden и НЕ пишет', async () => {
    const { prisma, update } = makePrisma({ inPortfolio: false });

    const res = await setOrgRequisites(prisma, partner('admin'), ORG_ID, VALUES);

    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(update).not.toHaveBeenCalled();
  });

  it('партнёр чужой организации не читает реквизиты', async () => {
    const { prisma } = makePrisma({ inPortfolio: false });

    const res = await getOrgRequisites(prisma, partner('admin'), ORG_ID);

    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('суженный скоуп assignedOrgIds режет доступ к организации вне списка', async () => {
    const { prisma, update } = makePrisma({ inPortfolio: true });
    const scoped = partner('admin', { assignedOrgIds: ['org-other'] } as Partial<SessionPayload>);

    const res = await setOrgRequisites(prisma, scoped, ORG_ID, VALUES);

    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(update).not.toHaveBeenCalled();
  });

  it('партнёр без partnerId не проходит (защита от кривого токена)', async () => {
    const { prisma } = makePrisma({ inPortfolio: true });
    const broken = { sub: 'x', role: 'partner', partnerRole: 'admin' } as SessionPayload;

    expect(await getOrgRequisites(prisma, broken, ORG_ID)).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });
});
