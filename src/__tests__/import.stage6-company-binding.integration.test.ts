import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { commitImport } from '@/lib/services/import';
import { upsertOrgRecord, type WriteCtx } from '@/lib/services/oneCSync/writers';
import { emptySummary } from '@/lib/services/oneCSync/record-batch';
import type { OneCOrgDto } from '@/lib/services/oneCSync/dto';
import { findOrphanCompanies, applyOrphanBackfill } from '@/lib/services/oneCSync/backfill-orphans';

/**
 * Этап 6 ТЗ починки импорта (Т-41…Т-44) на живом Postgres:
 *  - Т-44 (guardrail): импорт файла с НОВОЙ организацией не создаёт ни одной
 *    Company — `company.count()` до и после равны; организация в выбранной компании;
 *  - Т-41 (руководитель): скоуп company кладёт новую организацию строго в
 *    компанию руководителя, createCompanyId её не перебивает;
 *  - Т-41 (без компании): воркер-путь без конфига — построчная явная ошибка
 *    `company_not_configured`, записи нет;
 *  - Т-42 (бэкфилл): сирота от старого дефекта §0.2 находится по сигнатуре,
 *    организация и заказ перевешиваются на целевую компанию, пустая Company
 *    удаляется; decoy-компании (с пользователем / с чужим именем) не трогаются.
 */
const prisma = new PrismaClient();
const STAMP = Date.now();

/** Валидный 10-значный ИНН из 9 базовых цифр — контрольная цифра честная. */
function makeInn10(seed9: string): string {
  const d = [...seed9].map(Number);
  const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const control = (w.reduce((acc, wi, i) => acc + wi * (d[i] ?? 0), 0) % 11) % 10;
  return seed9 + String(control);
}

// Все четыре ИНН — одинаковой длины с РАЗНЫМИ двузначными префиксами: смесь
// `6${last8}` и `61${last7}` совпадала, когда 8-я с конца цифра timestamp —
// «1» (окно ~2.8 часа) — тест 2 находил организацию теста 1 по ИНН в чужой
// компании и честно получал out_of_scope вместо создания.
const INN_FILE = makeInn10(`60${String(STAMP).slice(-7)}`);
const INN_LEADER = makeInn10(`61${String(STAMP).slice(-7)}`);
const INN_NOCONF = makeInn10(`62${String(STAMP).slice(-7)}`);
const INN_ORPHAN = makeInn10(`63${String(STAMP).slice(-7)}`);
const ORPHAN_NAME = `ООО Сирота §0.2 ${STAMP}`;

let adminSession: never;
let adminUserId: string;
let companyAId: string; // целевая компания admin-импорта и бэкфилла
let companyBId: string; // компания руководителя

function orgDto(externalId: string, name: string, inn: string): OneCOrgDto {
  // Без партнёра: поле отсутствует (прямой клиент, этап 4).
  return { externalId, name, inn, updatedAt: '2026-08-06T00:00:00Z' } as OneCOrgDto;
}

async function buildOrgOnlyBook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const orgs = wb.addWorksheet('Контрагенты');
  orgs.addRow(['Наименование', 'ИНН', 'КПП', 'ИНН партнёра']);
  orgs.addRow([`ООО Этап 6 ${STAMP}`, INN_FILE, '770601001', '']);
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `st6-admin-${STAMP}@test.local`,
      name: 'Админ этапа 6',
      role: 'admin',
      passwordHash: 'x',
    },
  });
  adminUserId = user.id;
  adminSession = { sub: user.id, role: 'admin' } as never;
  const a = await prisma.company.create({ data: { name: `Компания A этапа 6 ${STAMP}` } });
  const b = await prisma.company.create({ data: { name: `Компания B этапа 6 ${STAMP}` } });
  companyAId = a.id;
  companyBId = b.id;
});

afterAll(async () => {
  // Пользователь мог остаться прицепленным к decoy-компании при падении теста.
  await prisma.user.updateMany({ where: { id: adminUserId }, data: { companyId: null } });
  await prisma.order.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
  await prisma.order.deleteMany({ where: { title: { contains: `этапа 6 ${STAMP}` } } });
  await prisma.organization.deleteMany({
    where: { companyId: { in: [companyAId, companyBId] } },
  });
  // Сцена бэкфилла (если тест упал до её уборки): сирота и decoy-компании.
  await prisma.organization.deleteMany({ where: { name: { contains: `этапа 6 ${STAMP}` } } });
  await prisma.organization.deleteMany({ where: { name: ORPHAN_NAME } });
  await prisma.company.deleteMany({ where: { name: { contains: `этапа 6 ${STAMP}` } } });
  await prisma.company.deleteMany({ where: { name: ORPHAN_NAME } });
  await prisma.company.deleteMany({ where: { id: { in: [companyAId, companyBId] } } });
  // Батчи импорта: удаляем ДО пользователя. importedById nullable (SetNull),
  // поэтому удаление автора оставляет батч сиротой навсегда — такие сироты
  // копились и вытесняли состаренный батч из списка (take: 20) в тесте Т-40.
  await prisma.oneCImportBatch.deleteMany({ where: { importedById: adminUserId } });
  await prisma.auditLog.deleteMany({ where: { userId: adminUserId } });
  await prisma.user.delete({ where: { id: adminUserId } });
  await prisma.$disconnect();
});

describe('этап 6 — привязка к компании (живой Postgres)', () => {
  it('Т-44: импорт создаёт организацию в выбранной компании и НИ ОДНОЙ Company', async () => {
    const book = await buildOrgOnlyBook();
    const companiesBefore = await prisma.company.count();

    const res = await commitImport(prisma, adminSession, {
      fileBuffer: book,
      fileName: 'st6.xlsx',
      companyId: companyAId,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.report.orgs.created).toBe(1);
      expect(res.report.orgs.failed).toBe(0);
    }

    const companiesAfter = await prisma.company.count();
    expect(companiesAfter).toBe(companiesBefore); // guardrail Т-44

    const org = await prisma.organization.findUnique({
      where: { externalId: `1c-inn:${INN_FILE}` },
      select: { companyId: true },
    });
    expect(org?.companyId).toBe(companyAId);
  });

  it('Т-41: руководитель (скоуп company) создаёт строго в своей компании — createCompanyId не перебивает', async () => {
    const ctx: WriteCtx = {
      mode: 'live',
      notify: false,
      scope: { kind: 'company', companyId: companyBId },
      createCompanyId: companyAId, // попытка подсунуть чужую — должна проиграть
    };
    const sum = emptySummary();
    await upsertOrgRecord(
      prisma,
      orgDto(`st6-leader-${STAMP}`, `Организация руководителя этапа 6 ${STAMP}`, INN_LEADER),
      sum,
      ctx
    );
    expect(sum.created).toBe(1);

    const org = await prisma.organization.findUnique({
      where: { externalId: `st6-leader-${STAMP}` },
      select: { companyId: true },
    });
    expect(org?.companyId).toBe(companyBId);
  });

  it('Т-41: путь воркера без компании — построчная company_not_configured, записи нет', async () => {
    const companiesBefore = await prisma.company.count();
    const ctx: WriteCtx = { mode: 'live', notify: false }; // ни скоупа, ни конфига
    const sum = emptySummary();
    await upsertOrgRecord(
      prisma,
      orgDto(`st6-noconf-${STAMP}`, `Организация без конфига этапа 6 ${STAMP}`, INN_NOCONF),
      sum,
      ctx
    );
    expect(sum.failed).toBe(1);
    expect(sum.failures[0]).toMatchObject({ error: 'company_not_configured' });
    expect(
      await prisma.organization.findUnique({ where: { externalId: `st6-noconf-${STAMP}` } })
    ).toBeNull();
    expect(await prisma.company.count()).toBe(companiesBefore);
  });

  it('Т-42: бэкфилл — сирота найдена по сигнатуре, организация и заказ перевешаны, пустая Company удалена', async () => {
    // Состояние старого дефекта §0.2: Company с именем контрагента, без
    // пользователей, с одной организацией и её заказом.
    const orphan = await prisma.company.create({ data: { name: ORPHAN_NAME } });
    const orphanOrg = await prisma.organization.create({
      data: { name: ORPHAN_NAME, inn: INN_ORPHAN, companyId: orphan.id },
    });
    const orphanOrder = await prisma.order.create({
      data: {
        title: `Заказ сироты этапа 6 ${STAMP}`,
        companyId: orphan.id,
        organizationId: orphanOrg.id,
      },
    });
    // Decoys: с пользователем — не кандидат; имя не совпадает — не кандидат.
    const withUser = await prisma.company.create({
      data: { name: `Не сирота (люди) этапа 6 ${STAMP}` },
    });
    await prisma.user.update({ where: { id: adminUserId }, data: { companyId: withUser.id } });
    const nameDiff = await prisma.company.create({
      data: { name: `Не сирота (имя) этапа 6 ${STAMP}` },
    });
    const nameDiffOrg = await prisma.organization.create({
      data: { name: `Организация с другим именем этапа 6 ${STAMP}`, companyId: nameDiff.id },
    });

    const scopeIds = [orphan.id, withUser.id, nameDiff.id];
    const candidates = await findOrphanCompanies(prisma, { companyIds: scopeIds });
    expect(candidates.map((c) => c.companyId)).toEqual([orphan.id]);
    expect(candidates[0]).toMatchObject({
      companyName: ORPHAN_NAME,
      organizationId: orphanOrg.id,
      ordersCount: 1,
    });

    // Отказы применения: целевая не существует / целевая сама сирота.
    expect(await applyOrphanBackfill(prisma, { targetCompanyId: 'no-such-company' })).toEqual({
      ok: false,
      error: 'target_not_found',
    });
    expect(
      await applyOrphanBackfill(prisma, { targetCompanyId: orphan.id, companyIds: scopeIds })
    ).toEqual({ ok: false, error: 'target_is_orphan' });

    // Применение к настоящей компании A.
    const res = await applyOrphanBackfill(prisma, {
      targetCompanyId: companyAId,
      companyIds: scopeIds,
    });
    expect(res).toEqual({
      ok: true,
      outcomes: [
        {
          companyId: orphan.id,
          companyName: ORPHAN_NAME,
          ordersMoved: 1,
          action: 'deleted',
        },
      ],
    });

    const movedOrg = await prisma.organization.findUnique({
      where: { id: orphanOrg.id },
      select: { companyId: true },
    });
    const movedOrder = await prisma.order.findUnique({
      where: { id: orphanOrder.id },
      select: { companyId: true },
    });
    expect(movedOrg?.companyId).toBe(companyAId);
    expect(movedOrder?.companyId).toBe(companyAId);
    expect(await prisma.company.findUnique({ where: { id: orphan.id } })).toBeNull();
    // Decoys не тронуты.
    expect(await prisma.company.findUnique({ where: { id: withUser.id } })).not.toBeNull();
    expect(await prisma.company.findUnique({ where: { id: nameDiff.id } })).not.toBeNull();

    // Уборка сцены бэкфилла (организация/заказ сироты уже в A — уберутся в afterAll).
    await prisma.user.update({ where: { id: adminUserId }, data: { companyId: null } });
    await prisma.organization.delete({ where: { id: nameDiffOrg.id } });
    await prisma.company.deleteMany({ where: { id: { in: [withUser.id, nameDiff.id] } } });
  });
});
