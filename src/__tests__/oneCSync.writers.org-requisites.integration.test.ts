import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { upsertOrgRecord, type WriteCtx } from '@/lib/services/oneCSync/writers';
import { emptySummary } from '@/lib/services/oneCSync/record-batch';
import { OneCOrgSchema } from '@/lib/services/oneCSync/schemas';
import type { OneCOrgDto } from '@/lib/services/oneCSync/dto';

/**
 * `У-171` (этап 8, PR-7) на живом Postgres — дефект `Д-23`: реквизиты
 * контрагента из 1С доезжают до `Organization`, а пустое из 1С не затирает
 * то, что менеджер вписал руками.
 *
 * Unit-тесты writer'а смотрят на аргументы `update`; здесь проверяется
 * результат в базе — что колонки действительно существуют и что «ключа нет в
 * update» на живой Prisma означает «значение осталось».
 */
const prisma = new PrismaClient();
const STAMP = Date.now();
const EXT = `1c-org-req-${STAMP}`;
const EXT_FRESH = `1c-org-req-fresh-${STAMP}`;

let companyId: string;
const ctx: WriteCtx = { mode: 'live', notify: false };

const REQUISITES = {
  legalName: `Общество с ограниченной ответственностью «Реквизиты ${STAMP}»`,
  ogrn: '1027700000001',
  legalAddress: '101000, г. Москва, ул. Первая, д. 1',
  bankName: 'ПАО Банк',
  bankAccount: '40702810000000000001',
  corrAccount: '30101810000000000001',
  bic: '044525001',
  signerName: 'Иванов И. И.',
  signerPosition: 'Генеральный директор',
  signerBasis: 'Устава',
} as const;

const SELECT = {
  name: true,
  kpp: true,
  legalName: true,
  ogrn: true,
  legalAddress: true,
  bankName: true,
  bankAccount: true,
  corrAccount: true,
  bic: true,
  signerName: true,
  signerPosition: true,
  signerBasis: true,
} as const;

function dto(externalId: string, over: Partial<OneCOrgDto> = {}): OneCOrgDto {
  // Через схему — как в воркере: лишнего поля тест не подсунет.
  return OneCOrgSchema.parse({
    externalId,
    name: `ООО Реквизиты ${STAMP}`,
    updatedAt: '2026-09-04T00:00:00Z',
    ...over,
  });
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `Компания У-171 ${STAMP}` } });
  companyId = company.id;
  // Организация, которую менеджер завёл руками и заполнил адрес в карточке.
  await prisma.organization.create({
    data: {
      externalId: EXT,
      name: `ООО Реквизиты ${STAMP}`,
      companyId,
      kpp: '770101001',
      legalAddress: 'Адрес, вписанный менеджером',
      signerName: 'Петров П. П.',
    },
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('У-171 — реквизиты контрагента из 1С (живой Postgres)', () => {
  it('1С без реквизитов: адрес, подписант и КПП менеджера остаются', async () => {
    const sum = emptySummary();
    const out = await upsertOrgRecord(prisma, dto(EXT), sum, ctx);
    expect(sum.updated).toBe(1);
    expect(out?.action).toBe('updated');

    const org = await prisma.organization.findUniqueOrThrow({
      where: { externalId: EXT },
      select: SELECT,
    });
    expect(org.legalAddress).toBe('Адрес, вписанный менеджером');
    expect(org.signerName).toBe('Петров П. П.');
    expect(org.kpp).toBe('770101001');
  });

  it('1С с пустыми строками — то же самое: «» и пробелы ничего не стирают', async () => {
    await upsertOrgRecord(
      prisma,
      dto(EXT, { legalAddress: '', signerName: '   ', kpp: '' }),
      emptySummary(),
      ctx
    );
    const org = await prisma.organization.findUniqueOrThrow({
      where: { externalId: EXT },
      select: SELECT,
    });
    expect(org.legalAddress).toBe('Адрес, вписанный менеджером');
    expect(org.signerName).toBe('Петров П. П.');
    expect(org.kpp).toBe('770101001');
  });

  it('непустое из 1С заменяет: адрес и подписант становятся такими, как в 1С; legalName доезжает (Д-23)', async () => {
    await upsertOrgRecord(prisma, dto(EXT, { ...REQUISITES }), emptySummary(), ctx);
    const org = await prisma.organization.findUniqueOrThrow({
      where: { externalId: EXT },
      select: SELECT,
    });
    expect(org).toMatchObject(REQUISITES);
    // Чего 1С не прислала, то не тронуто.
    expect(org.kpp).toBe('770101001');
  });

  it('следующий обмен без реквизитов не откатывает то, что пришло из 1С раньше', async () => {
    await upsertOrgRecord(prisma, dto(EXT), emptySummary(), ctx);
    const org = await prisma.organization.findUniqueOrThrow({
      where: { externalId: EXT },
      select: SELECT,
    });
    expect(org).toMatchObject(REQUISITES);
  });

  it('первый импорт новой организации заполняет все реквизиты сразу', async () => {
    const sum = emptySummary();
    const out = await upsertOrgRecord(
      prisma,
      dto(EXT_FRESH, { name: `ООО Новая ${STAMP}`, kpp: '502401001', ...REQUISITES }),
      sum,
      { ...ctx, createCompanyId: companyId }
    );
    expect(sum.created).toBe(1);
    expect(out?.action).toBe('created');
    const org = await prisma.organization.findUniqueOrThrow({
      where: { externalId: EXT_FRESH },
      select: SELECT,
    });
    expect(org).toMatchObject({ kpp: '502401001', ...REQUISITES });
  });
});
