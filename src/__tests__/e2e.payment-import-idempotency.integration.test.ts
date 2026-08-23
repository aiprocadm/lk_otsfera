import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { commitPaymentImport } from '@/lib/services/import/oneCAccountCard/import-batch';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * E2E — 1C Card-51 payment import idempotency (integration).
 *
 * Exercises the REAL production commit path `commitPaymentImport(prisma, session,
 * { fileBuffer, fileName })`, which internally reads the xlsx grid → parses the
 * account-card → classifies → matches → writes via the 1C `upsertPaymentRecord`
 * writer (Payment.externalId @unique is the idempotency key).
 *
 * Asserted end-to-end over a live Postgres:
 *  1. Importing a Card-51 set CREATES Payment rows for client rows (корр-счёт 62,
 *     Поступление) that resolve by INN → exact match.
 *  2. RE-importing the SAME set does NOT duplicate — Payment count and queue-row
 *     count stay equal (externalId idempotency).
 *  3. Non-client rows (корр-счёт 60 supplier) are FILTERED OUT (excluded, no
 *     Payment, no queue row).
 *  4. `У-86` (решение `Р-11`): контрагент без ИНН, но с названием — больше НЕ
 *     повод для ручного разбора: импорт заводит организацию по названию и
 *     привязывает платёж. В очередь (`PaymentImportRow` status='needs_review')
 *     уходит только строка, у которой нет НИ названия, НИ ИНН, — и она тоже не
 *     теряется и не дублируется при повторном импорте.
 *
 * Money is Prisma.Decimal — asserted via `.toFixed(2)` string comparison, never JS
 * number equality. STAMP is used ONLY for unique fixture NAMES; all id/externalId/
 * status assertions are on deterministic values.
 */

// ── Hermetic mocks: no network. ──────────────────────────────────────────────
// S3 (commitPaymentImport best-effort uploads the source file). Mock so the test
// never reaches an object store, matching CLAUDE.md §10 / the no-network rule.
const { uploadMock } = vi.hoisted(() => ({ uploadMock: vi.fn(async () => {}) }));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    upload: uploadMock,
    download: vi.fn(),
    createSignedUrl: vi.fn(),
    remove: vi.fn(),
  }),
}));
// Notification fan-out (email/Telegram dispatch). The org-level payment path in
// this test does not trigger them (no resolved order), but mock defensively so a
// future writer change can never open a network channel from this test.
vi.mock('@/lib/notifications', () => ({
  notifyOrgUsers: vi.fn(async () => ({ recipientsNotified: 0 })),
  notifyManagers: vi.fn(async () => ({ recipientsNotified: 0 })),
}));

const prisma = new PrismaClient();
const STAMP = Date.now();

// Fixed, deterministic identifiers asserted on (NOT derived from STAMP).
const CLIENT_INN = '7799001122';
const EXT_MATCHED = '0000-770101'; // INN-match client row → Payment
// `У-86`: ИНН нет, но название есть → организация создаётся по названию → Payment
const EXT_NEW_ORG = '0000-770102';
const EXT_SUPPLIER = '0000-770103'; // корр-счёт 60 → excluded (filtered out)
// Ни названия, ни ИНН — единственный оставшийся повод для очереди (`У-51`)
const EXT_NO_NAME = '0000-770104';
const NEW_ORG_NAME = 'ЗАГАДОЧНЫЙ ПЛАТЕЛЬЩИК БЕЗ ИНН';

const ADMIN_ID = `pi-admin-${STAMP}`;
const adminSession = { sub: ADMIN_ID, role: 'admin', companyId: null } as unknown as SessionPayload;

let orgId = '';
let companyId = '';

/**
 * Build a Card-51 workbook exactly like the production reader expects:
 * col[0]=date, col[1]=document (line1 has doc № + "Поступление/Списание"),
 * col[3]=analytics (counterparty [+ ИНН]), col[5]=debit, col[7]=corr-account,
 * col[8]=credit. Sliced between «Сальдо на начало» … «Обороты за период».
 */
async function cardBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Лист1');
  ws.addRow(['Сальдо на начало']);
  // 1) client, INN known → exact INN-match → Payment. НДС явной суммой 100-00 (=100.00).
  ws.addRow([
    '01.06.2026',
    `Поступление на расчетный счет ${EXT_MATCHED} от 01.06.2026 10:00:00\nОплата по счету № PI-1 В Т.Ч. НДС (5%) 100-00`,
    '',
    `ТЕСТ ОРГ ИДЕМ ООО ИНН ${CLIENT_INN}`,
    '',
    '21000',
    '',
    '62.01',
  ]);
  // 2) client, no INN + unknown counterparty name → `У-86`: организация заводится
  //    по названию, платёж привязывается к ней (раньше строка шла в очередь).
  ws.addRow([
    '02.06.2026',
    `Поступление на расчетный счет ${EXT_NEW_ORG} от 02.06.2026 10:00:00\nОплата по счету № PI-2`,
    '',
    NEW_ORG_NAME,
    '',
    '5000',
    '',
    '62.01',
  ]);
  // 3) supplier (корр-счёт 60) → excluded, filtered out (not client корр 62).
  ws.addRow([
    '03.06.2026',
    `Списание с расчетного счета ${EXT_SUPPLIER} от 03.06.2026 10:00:00\nоплата поставщику`,
    '',
    'ПОСТАВЩИК ИДЕМ',
    '',
    '',
    '',
    '60',
    '900',
  ]);
  // 4) client row без контрагента вовсе (пустая аналитика): создавать нечего —
  //    строка уходит в ручной разбор. Это единственный оставшийся путь в очередь.
  ws.addRow([
    '04.06.2026',
    `Поступление на расчетный счет ${EXT_NO_NAME} от 04.06.2026 10:00:00\nОплата по счету № PI-4`,
    '',
    '',
    '',
    '3000',
    '',
    '62.01',
  ]);
  ws.addRow(['Обороты за период и сальдо на конец']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

beforeAll(async () => {
  // PaymentImportBatch.importedById has a real FK to User → session.sub must exist.
  await prisma.user.create({
    data: { id: ADMIN_ID, email: `${ADMIN_ID}@card51.test`, name: 'PI Admin', role: 'admin' },
  });
  const company = await prisma.company.create({ data: { name: `PI Co ${STAMP}` } });
  companyId = company.id;
  const org = await prisma.organization.create({
    data: { name: `ТЕСТ ОРГ ИДЕМ ООО ${STAMP}`, inn: CLIENT_INN, companyId: company.id },
  });
  orgId = org.id;
});

afterAll(async () => {
  const EXT_ALL = [EXT_MATCHED, EXT_NEW_ORG, EXT_SUPPLIER, EXT_NO_NAME];
  await prisma.payment.deleteMany({ where: { externalId: { in: EXT_ALL } } });
  await prisma.paymentImportRow.deleteMany({ where: { externalId: { in: EXT_ALL } } });
  await prisma.paymentImportBatch.deleteMany({ where: { importedById: ADMIN_ID } });
  // Организацию по названию (`У-86`) завёл сам импорт — чистим всю компанию.
  await prisma.organization.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  // commitPaymentImport writes audit logs keyed to session.sub → clear before user (FK).
  await prisma.auditLog.deleteMany({ where: { userId: ADMIN_ID } });
  await prisma.user.deleteMany({ where: { id: ADMIN_ID } });
  await prisma.$disconnect();
});

describe('1C payment import — idempotency (integration)', () => {
  it('first import: INN-match → Payment, name-only → org created + Payment, no-name → queue, supplier(60) → filtered out', async () => {
    const res = await commitPaymentImport(prisma, adminSession, {
      fileBuffer: await cardBuffer(),
      fileName: 'card.xlsx',
      // `У-50`: контрагент без ИНН — тоже кандидат на создание, поэтому админ
      // обязан назвать компанию (иначе сервис отвечает `company_required`).
      companyId,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      // two exact imports (ИНН + название), one queued (без реквизитов вовсе),
      // one excluded — supplier row filtered by классификация.
      expect(res.result.counts.imported).toBe(2);
      expect(res.result.counts.queued).toBe(1);
      expect(res.result.counts.excluded).toBe(1);
      expect(res.result.counts.excludedByReason.supplier).toBe(1);
      // `У-86`: организация по названию — ровно одна.
      expect(res.result.counts.orgsCreated).toBe(1);
    }

    // (a) client INN-match row → Payment created, bound to the org, money exact via Decimal.
    const pay = await prisma.payment.findUnique({ where: { externalId: EXT_MATCHED } });
    expect(pay).not.toBeNull();
    expect(pay?.organizationId).toBe(orgId);
    expect(pay?.amount).toBeInstanceOf(Prisma.Decimal);
    expect(pay?.amount.toFixed(2)).toBe('21000.00');
    expect(pay?.vatAmount?.toFixed(2)).toBe('100.00');
    expect(pay?.isRefund).toBe(false);

    // (b) `У-86`/`Р-11`: контрагент без ИНН, но с названием — организация
    //     заведена импортом, платёж привязан к ней, в очереди строки НЕТ.
    const newOrg = await prisma.organization.findFirst({
      where: { companyId, nameKey: NEW_ORG_NAME },
      select: { id: true, inn: true },
    });
    expect(newOrg).not.toBeNull();
    // ИНН в файле нет, ЕГРЮЛ в тестовой среде выключен → организация без ИНН.
    expect(newOrg?.inn).toBeNull();
    const byName = await prisma.payment.findUnique({ where: { externalId: EXT_NEW_ORG } });
    expect(byName?.organizationId).toBe(newOrg?.id);
    expect(byName?.amount.toFixed(2)).toBe('5000.00');
    expect(
      await prisma.paymentImportRow.findUnique({ where: { externalId: EXT_NEW_ORG } })
    ).toBeNull();

    // (c) строка без названия и без ИНН → ручной разбор: не потеряна, не Payment.
    const queued = await prisma.paymentImportRow.findUnique({
      where: { externalId: EXT_NO_NAME },
    });
    expect(queued).not.toBeNull();
    expect(queued?.status).toBe('needs_review');
    expect(queued?.amount.toFixed(2)).toBe('3000.00');
    expect(await prisma.payment.findUnique({ where: { externalId: EXT_NO_NAME } })).toBeNull();

    // (d) supplier (корр-счёт 60) filtered out — no Payment and no queue row anywhere.
    expect(await prisma.payment.findUnique({ where: { externalId: EXT_SUPPLIER } })).toBeNull();
    expect(
      await prisma.paymentImportRow.findUnique({ where: { externalId: EXT_SUPPLIER } })
    ).toBeNull();
  });

  it('re-import of the SAME set is idempotent: no duplicate Payment, org or queue row', async () => {
    // Baseline before the second run.
    const payBefore = await prisma.payment.count({ where: { externalId: EXT_MATCHED } });
    const byNameBefore = await prisma.payment.count({ where: { externalId: EXT_NEW_ORG } });
    const queueBefore = await prisma.paymentImportRow.count({
      where: { externalId: EXT_NO_NAME },
    });
    expect(payBefore).toBe(1);
    expect(byNameBefore).toBe(1);
    expect(queueBefore).toBe(1);

    const res = await commitPaymentImport(prisma, adminSession, {
      fileBuffer: await cardBuffer(),
      fileName: 'card.xlsx',
      companyId,
    });
    expect(res.ok).toBe(true);
    // `У-86`: во второй раз создавать нечего — организация уже нашлась по ключу.
    if (res.ok) expect(res.result.counts.orgsCreated).toBe(0);

    // Payment.externalId @unique → upsert-by-externalId keeps the count at exactly 1.
    const payAfter = await prisma.payment.count({ where: { externalId: EXT_MATCHED } });
    expect(payAfter).toBe(1);
    expect(await prisma.payment.count({ where: { externalId: EXT_NEW_ORG } })).toBe(1);
    // Дубля организации по названию не появилось (дедуп по ключу в компании).
    expect(
      await prisma.organization.count({ where: { companyId, nameKey: NEW_ORG_NAME } })
    ).toBe(1);
    // PaymentImportRow.externalId @unique → the queue row is updated in place, not re-created.
    const queueAfter = await prisma.paymentImportRow.count({
      where: { externalId: EXT_NO_NAME },
    });
    expect(queueAfter).toBe(1);
    // Still needs_review (unmatched a second time) — not silently resolved/duplicated.
    const queued = await prisma.paymentImportRow.findUnique({
      where: { externalId: EXT_NO_NAME },
    });
    expect(queued?.status).toBe('needs_review');

    // Supplier row remains filtered out across re-imports.
    expect(await prisma.payment.count({ where: { externalId: EXT_SUPPLIER } })).toBe(0);
    expect(await prisma.paymentImportRow.count({ where: { externalId: EXT_SUPPLIER } })).toBe(0);

    // Two committed batches recorded (idempotency lives in the rows, not the batch log).
    expect(await prisma.paymentImportBatch.count({ where: { importedById: ADMIN_ID } })).toBe(2);
  });
});
