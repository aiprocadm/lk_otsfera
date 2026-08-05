import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { upsertOrgRecord, type WriteCtx } from '@/lib/services/oneCSync/writers';
import { runRecordBatch } from '@/lib/services/oneCSync/record-batch';
import { OneCOrgSchema } from '@/lib/services/oneCSync/schemas';
import type { OneCOrgDto } from '@/lib/services/oneCSync/dto';

/**
 * Этап 4 ТЗ починки импорта (Т-19/Т-19а/Т-20) на живом Postgres:
 *  - контрагент без партнёра создаётся как ПРЯМОЙ клиент (`partnerId: null`);
 *  - две строки с одним «ИНН партнёра» дают ДВЕ организации с одним partnerId;
 *  - указанный, но несуществующий партнёр → skip `partner_not_found`;
 *  - повторный прогон идемпотентен (created: 0, updated: N).
 */
const prisma = new PrismaClient();
const STAMP = Date.now();
const PARTNER_INN = `77${String(STAMP).slice(-8)}`;
const ORG_INN_A = `50${String(STAMP).slice(-8)}`;
const ORG_INN_B = `52${String(STAMP).slice(-8)}`;
const ORG_INN_DIRECT = `54${String(STAMP).slice(-8)}`;
const EXT = (suffix: string) => `st4-${STAMP}-${suffix}`;

const CTX: WriteCtx = { mode: 'live', notify: false, scope: { kind: 'global' } };

let partnerId: string;

function orgDto(over: Partial<OneCOrgDto> & { externalId: string }): OneCOrgDto {
  return {
    name: `Орг ${over.externalId}`,
    updatedAt: '2026-08-05T00:00:00Z',
    ...over,
  } as OneCOrgDto;
}

async function runBatch(dtos: OneCOrgDto[]) {
  return runRecordBatch<OneCOrgDto>(
    dtos,
    OneCOrgSchema,
    (d) => d.externalId,
    (d, s) => upsertOrgRecord(prisma, d, s, CTX)
  );
}

beforeAll(async () => {
  const partner = await prisma.partner.create({
    data: {
      name: `Партнёр этапа 4 ${STAMP}`,
      slug: `stage4-partner-${STAMP}`,
      inn: PARTNER_INN,
    },
  });
  partnerId = partner.id;
});

afterAll(async () => {
  // Организации ссылаются на Company (минт этапа до Т-41) — чистим каскадом снизу.
  const orgs = await prisma.organization.findMany({
    where: { externalId: { startsWith: `st4-${STAMP}-` } },
    select: { id: true, companyId: true },
  });
  await prisma.organization.deleteMany({ where: { id: { in: orgs.map((o) => o.id) } } });
  const companyIds = orgs.map((o) => o.companyId).filter((x): x is string => x !== null);
  await prisma.company.deleteMany({ where: { id: { in: companyIds }, users: { none: {} } } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.$disconnect();
});

describe('этап 4 — партнёр необязателен (живой Postgres)', () => {
  it('Т-19: контрагент без партнёра создаётся прямым клиентом (partnerId: null)', async () => {
    const sum = await runBatch([orgDto({ externalId: EXT('direct'), inn: ORG_INN_DIRECT })]);
    expect(sum.created).toBe(1);
    expect(sum.skips).toEqual([]);

    const org = await prisma.organization.findUnique({
      where: { externalId: EXT('direct') },
      select: { partnerId: true, inn: true },
    });
    expect(org).not.toBeNull();
    expect(org?.partnerId).toBeNull();
  });

  it('Т-19а + Т-20: две строки с одним «ИНН партнёра» → две организации, один partnerId', async () => {
    const sum = await runBatch([
      orgDto({ externalId: EXT('a'), inn: ORG_INN_A, partnerExternalId: PARTNER_INN }),
      orgDto({ externalId: EXT('b'), inn: ORG_INN_B, partnerExternalId: ` ${PARTNER_INN} ` }),
    ]);
    expect(sum.created).toBe(2);
    expect(sum.skips).toEqual([]);

    const orgs = await prisma.organization.findMany({
      where: { externalId: { in: [EXT('a'), EXT('b')] } },
      select: { partnerId: true },
    });
    expect(orgs).toHaveLength(2);
    expect(orgs.every((o) => o.partnerId === partnerId)).toBe(true);
  });

  it('Т-20: партнёр находится и по прежнему slug (сетевой путь adapter-rest)', async () => {
    const sum = await runBatch([
      orgDto({
        externalId: EXT('slug'),
        inn: `56${String(STAMP).slice(-8)}`,
        partnerExternalId: `stage4-partner-${STAMP}`,
      }),
    ]);
    expect(sum.created).toBe(1);
    const org = await prisma.organization.findUnique({
      where: { externalId: EXT('slug') },
      select: { partnerId: true },
    });
    expect(org?.partnerId).toBe(partnerId);
  });

  it('указанный, но несуществующий партнёр → skip partner_not_found, организация не создана', async () => {
    const sum = await runBatch([
      orgDto({
        externalId: EXT('ghost'),
        inn: `58${String(STAMP).slice(-8)}`,
        partnerExternalId: '0000000000',
      }),
    ]);
    expect(sum.created).toBe(0);
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason: 'partner_not_found' });
    expect(
      await prisma.organization.findUnique({ where: { externalId: EXT('ghost') } })
    ).toBeNull();
  });

  it('Т-23-предвестник: повторный прогон идемпотентен (created: 0, updated: N)', async () => {
    const again = await runBatch([
      orgDto({ externalId: EXT('direct'), inn: ORG_INN_DIRECT }),
      orgDto({ externalId: EXT('a'), inn: ORG_INN_A, partnerExternalId: PARTNER_INN }),
    ]);
    expect(again.created).toBe(0);
    expect(again.updated).toBe(2);
    expect(again.skips).toEqual([]);
  });
});
