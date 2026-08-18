import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { previewImport, commitImport } from '@/lib/services/import';

/**
 * Этап 7 ТЗ починки импорта (Т-25/Т-26) на живом Postgres — путь РУКОВОДИТЕЛЯ
 * через сервис (не writer напрямую, как в тесте этапа 6):
 *  - предпросмотр и импорт руководителю разрешены БЕЗ передачи companyId —
 *    организация создаётся в его собственной компании (скоуп, Т-41);
 *  - Company при этом не минтится (инвариант Т-44 держится и на этом пути);
 *  - обычному менеджеру сервис отвечает forbidden до разбора файла.
 */
const prisma = new PrismaClient();
const STAMP = Date.now();

function makeInn10(seed9: string): string {
  const d = [...seed9].map(Number);
  const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const control = (w.reduce((acc, wi, i) => acc + wi * (d[i] ?? 0), 0) % 11) % 10;
  return seed9 + String(control);
}

const ORG_INN = makeInn10(`7${String(STAMP).slice(-8)}`);
const ORG_KEY = `1c-inn:${ORG_INN}`;

let leaderSession: never;
let leaderUserId: string;
let companyId: string;
let book: Buffer;

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `Компания этапа 7 ${STAMP}` } });
  companyId = company.id;
  // Настоящий пользователь — commitImport пишет аудит с FK на User.
  const user = await prisma.user.create({
    data: {
      email: `st7-leader-${STAMP}@test.local`,
      name: 'Руководитель этапа 7',
      role: 'manager',
      passwordHash: 'x',
      companyId,
    },
  });
  leaderUserId = user.id;
  leaderSession = {
    sub: user.id,
    role: 'leader',
    companyId,
    managedOrgIds: [],
  } as never;

  const wb = new ExcelJS.Workbook();
  const orgs = wb.addWorksheet('Контрагенты');
  orgs.addRow(['Наименование', 'ИНН', 'КПП', 'ИНН партнёра']);
  orgs.addRow([`ООО Этап 7 ${STAMP}`, ORG_INN, '770701001', '']);
  book = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { externalId: ORG_KEY } });
  await prisma.auditLog.deleteMany({ where: { userId: leaderUserId } });
  await prisma.user.delete({ where: { id: leaderUserId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('этап 7 — роли на живом Postgres', () => {
  // Решение заказчика 11.08.2026 отменило прежний запрет (`Т-25`): импорт
  // доступен и обычному менеджеру. Но его скоуп — только закреплённые
  // организации, поэтому НОВУЮ организацию он по-прежнему не заводит: это
  // молча расширило бы его доступ. Проверяем именно это — право есть,
  // запись не появляется.
  it('обычный менеджер: импорт проходит, но новую организацию не создаёт (скоуп orgs)', async () => {
    const plain = {
      sub: leaderUserId,
      role: 'manager',
      companyId,
      managedOrgIds: [],
    } as never;
    expect(await previewImport(prisma, plain, { fileBuffer: book })).toMatchObject({ ok: true });
    expect(await commitImport(prisma, plain, { fileBuffer: book })).toMatchObject({ ok: true });
    expect(await prisma.organization.findUnique({ where: { externalId: ORG_KEY } })).toBeNull();
  });

  it('руководитель: предпросмотр и импорт БЕЗ companyId — организация в его компании, Company не минтится', async () => {
    const companiesBefore = await prisma.company.count();

    const preview = await previewImport(prisma, leaderSession, { fileBuffer: book });
    expect(preview.ok).toBe(true);
    if (preview.ok) expect(preview.report.orgs.created).toBe(1);
    expect(await prisma.company.count()).toBe(companiesBefore); // предпросмотр не пишет

    const res = await commitImport(prisma, leaderSession, { fileBuffer: book });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.report.orgs.created).toBe(1);
      expect(res.report.orgs.failed).toBe(0);
      expect(res.report.orgs.skips).toEqual([]); // никакого out_of_scope (Т-26а снят)
    }
    expect(await prisma.company.count()).toBe(companiesBefore); // Т-44 и для руководителя

    const org = await prisma.organization.findUnique({
      where: { externalId: ORG_KEY },
      select: { companyId: true },
    });
    expect(org?.companyId).toBe(companyId);
  });
});
