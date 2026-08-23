import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';

// Best-effort side-channels of commitPaymentImport (S3 store, sync-log, audit)
// are mocked to THROW so the three non-blocking catch arms (import-batch.ts
// lines 106/111/114) are exercised deterministically; the success side of each
// is already covered by import.card51.integration.test.ts.
const { uploadThrows } = vi.hoisted(() => ({ uploadThrows: vi.fn() }));
vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ upload: uploadThrows }) }));
vi.mock('@/lib/services/oneCSync/log', () => ({
  writeSyncLog: vi.fn(async () => {
    throw new Error('log down');
  }),
}));
vi.mock('@/lib/auth/audit', () => ({
  recordAudit: vi.fn(async () => {
    throw new Error('audit down');
  }),
}));

// server-actions/payment-import wraps the real service. Only the auth boundary
// (requireSession) is mocked; the barrel service + singleton prisma stay real so
// the actions run against the same live Postgres as the direct-call tests above.
const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));

import {
  previewPaymentImport,
  commitPaymentImport,
} from '@/lib/services/import/oneCAccountCard/import-batch';
import {
  listQueue,
  resolveQueueRow,
  dismissQueueRow,
} from '@/lib/services/import/oneCAccountCard/resolve-queue';
import {
  commitPaymentImportAction,
  resolveQueueRowAction,
  dismissQueueRowAction,
} from '@/server-actions/payment-import';
import { IMPORT_MAX_FILE_BYTES } from '@/lib/config/import-limits';

const prisma = new PrismaClient();
const STAMP = Date.now();

// Deterministic ids/values (unique to this test — no cross-file 1C fixture overlap).
const INN = '5599001122';
const COMPANY_NAME = `Cov Import Co ${STAMP}`;
const OTHER_COMPANY_NAME = `Cov Import Other Co ${STAMP}`;

const adminSession = { sub: 'cov-import-admin', role: 'admin', companyId: null } as never;
const orgSession = { sub: 'cov-import-org', role: 'organization' } as never;

let companyId = '';
let otherCompanyId = '';
let orgWithInnId = '';
let orgNullId = '';
let orderWithExtId = '';
let batchId = '';
let managerInCompany = undefined as never;
let managerNoCompany = undefined as never;
let managerOtherCompany = undefined as never;

// Every PaymentImportRow externalId we create (also the Payment externalIds the
// resolve path may materialise) → single cleanup source of truth.
const ROW_EXT = {
  a: 'RQ-A-0001',
  b: 'RQ-B-0001',
  c: 'RQ-C-0001',
  resolved: 'RQ-RES-0001',
  scope: 'RQ-SCOPE-0001',
  dismiss: 'RQ-DISMISS-0001',
  orgReq: 'RQ-ORGREQ-0001',
  orgMissing: 'RQ-ORGMISS-0001',
};
const COMMIT_EXT = ['0000-000701', '0000-000702', '0000-000703', '0000-000705'];
const ORDER_EXT = 'RQ-ORD-0001';

function makeRow(
  externalId: string,
  opts: {
    batchId: string;
    isRefund?: boolean;
    purpose?: string | null;
    paymentOrderNumber?: string | null;
    vatAmount?: number | null;
    status?: string;
    candidateOrgId?: string | null;
    candidateOrderId?: string | null;
  }
) {
  return prisma.paymentImportRow.create({
    data: {
      batchId: opts.batchId,
      externalId,
      paidAt: new Date('2026-07-01T00:00:00.000Z'),
      amount: 12000,
      isRefund: opts.isRefund ?? false,
      purpose: opts.purpose ?? null,
      paymentOrderNumber: opts.paymentOrderNumber ?? null,
      vatAmount: opts.vatAmount ?? null,
      counterpartyName: 'Some Party',
      counterpartyInn: null,
      accountCandidates: [] as unknown as Prisma.InputJsonValue,
      status: opts.status ?? 'needs_review',
      candidateOrgId: opts.candidateOrgId ?? null,
      candidateOrderId: opts.candidateOrderId ?? null,
      matchMethod: 'none',
      rawRow: [] as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
}

/** Карточка счёта 51: exact-payment, exact-refund, queue, excluded(60), parse-error. */
async function commitBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Лист1');
  ws.addRow(['Сальдо на начало']);
  // exact non-refund (Поступление + 62, ИНН-match) → imported
  ws.addRow([
    '01.07.2026',
    'Поступление на расчетный счет 0000-000701 от 01.07.2026 10:00:00\nОплата по договору',
    '',
    `КЛИЕНТ ООО ИНН ${INN}`,
    '',
    '18000',
    '',
    '62.01',
    '',
  ]);
  // exact refund (Списание + 62, ИНН-match, сумма в кредите) → imported + refund
  ws.addRow([
    '02.07.2026',
    'Списание с расчетного счета 0000-000702 от 02.07.2026 10:00:00\nВозврат клиенту',
    '',
    `КЛИЕНТ ООО ИНН ${INN}`,
    '',
    '',
    '',
    '62.01',
    '3000',
  ]);
  // queue: контрагента нет вовсе (ни названия, ни ИНН) → queued.
  // `У-86`/решение `Р-11`: незнакомое ИМЯ больше не повод для очереди — по нему
  // импорт заводит организацию. Строка без реквизитов — единственный путь в
  // ручной разбор, и здесь нужен именно он: администратор зовёт сервис БЕЗ
  // companyId, а при наличии кандидата это был бы отказ `company_required`.
  ws.addRow([
    '03.07.2026',
    'Поступление на расчетный счет 0000-000703 от 03.07.2026 10:00:00\nОплата',
    '',
    '',
    '',
    '5000',
    '',
    '62.01',
    '',
  ]);
  // excluded (corr 60 → supplier)
  ws.addRow([
    '04.07.2026',
    'Списание с расчетного счета 0000-000704 от 04.07.2026 10:00:00\nоплата поставщику',
    '',
    'ПОСТАВЩИК',
    '',
    '',
    '',
    '60',
    '900',
  ]);
  // parse-error (payment kind, но нет суммы и даты) → parseErrors → syncLog status 'warn'
  ws.addRow([
    '',
    'Поступление на расчетный счет 0000-000705 от 04.07.2026\nОплата',
    '',
    `КЛИЕНТ ООО ИНН ${INN}`,
    '',
    '',
    '',
    '62.01',
    '',
  ]);
  ws.addRow(['Обороты за период и сальдо на конец']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

beforeAll(async () => {
  // default S3 failure = Error → hits the `e instanceof Error ? e.message` arm (import-batch L106).
  uploadThrows.mockRejectedValue(new Error('s3 down'));
  // commitPaymentImport writes batch.importedById → real User FK.
  await prisma.user.create({
    data: {
      id: 'cov-import-admin',
      email: `cov-import-admin-${STAMP}@t.test`,
      name: 'Cov Admin',
      role: 'admin',
    },
  });
  const company = await prisma.company.create({ data: { name: COMPANY_NAME } });
  companyId = company.id;
  const other = await prisma.company.create({ data: { name: OTHER_COMPANY_NAME } });
  otherCompanyId = other.id;

  const orgWithInn = await prisma.organization.create({
    data: { name: `Клиент ООО ${STAMP}`, inn: INN, externalId: `CV-ORG-${STAMP}`, companyId },
  });
  orgWithInnId = orgWithInn.id;
  const orgNull = await prisma.organization.create({
    data: { name: `Без реквизитов ${STAMP}`, inn: null, externalId: null, companyId },
  });
  orgNullId = orgNull.id;

  const order = await prisma.order.create({
    data: {
      title: `Cov order ${STAMP}`,
      externalId: ORDER_EXT,
      companyId,
      organizationId: orgWithInnId,
    },
  });
  orderWithExtId = order.id;

  const batch = await prisma.paymentImportBatch.create({
    data: {
      importedById: 'cov-import-admin',
      companyId,
      fileName: 'seed.xlsx',
      counts: {} as unknown as Prisma.InputJsonValue,
      status: 'committed',
    },
  });
  batchId = batch.id;

  await makeRow(ROW_EXT.a, { batchId, candidateOrgId: orgNullId });
  await makeRow(ROW_EXT.b, {
    batchId,
    isRefund: true,
    purpose: 'Возврат по договору',
    paymentOrderNumber: 'PN-77',
    vatAmount: 500,
    candidateOrgId: orgWithInnId,
    candidateOrderId: orderWithExtId,
  });
  await makeRow(ROW_EXT.c, { batchId, candidateOrgId: orgWithInnId });
  await makeRow(ROW_EXT.resolved, { batchId, status: 'resolved' });
  await makeRow(ROW_EXT.scope, { batchId });
  await makeRow(ROW_EXT.dismiss, { batchId });
  await makeRow(ROW_EXT.orgReq, { batchId });
  await makeRow(ROW_EXT.orgMissing, { batchId });

  managerInCompany = {
    sub: 'cov-import-mgr',
    role: 'manager',
    companyId,
    managedOrgIds: [orgWithInnId],
  } as never;
  managerNoCompany = { sub: 'cov-import-mgr2', role: 'manager', companyId: null } as never;
  managerOtherCompany = {
    sub: 'cov-import-mgr3',
    role: 'manager',
    companyId: otherCompanyId,
  } as never;
});

afterAll(async () => {
  await prisma.payment.deleteMany({
    where: { externalId: { in: [...COMMIT_EXT, ROW_EXT.b, ROW_EXT.c] } },
  });
  await prisma.paymentImportRow.deleteMany({
    where: { externalId: { in: [...Object.values(ROW_EXT), ...COMMIT_EXT] } },
  });
  // batches: seed + direct-call commits (companyId=null for admin) + action commit → clean by importer/company.
  await prisma.paymentImportBatch.deleteMany({
    where: {
      OR: [
        { companyId: { in: [companyId, otherCompanyId] } },
        { importedById: 'cov-import-admin' },
      ],
    },
  });
  await prisma.order.deleteMany({ where: { externalId: ORDER_EXT } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgWithInnId, orgNullId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  await prisma.user.deleteMany({ where: { id: 'cov-import-admin' } });
  await prisma.$disconnect();
});

describe('previewPaymentImport (cov)', () => {
  it('denies non-staff (organization) role', async () => {
    const res = await previewPaymentImport(prisma, orgSession, {
      fileBuffer: Buffer.from(''),
      fileName: 'x.xlsx',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('maps an unreadable file to parse_failed', async () => {
    const res = await previewPaymentImport(prisma, adminSession, {
      fileBuffer: Buffer.from('not a spreadsheet'),
      fileName: 'broken.xlsx',
    });
    expect(res).toEqual({ ok: false, error: 'parse_failed' });
  });

  // Решение заказчика 11.08.2026 отменило `Т-25`: обычный менеджер проходит
  // гейт наравне с руководителем. Границу режет скоуп, а не право.
  it('обычный менеджер и руководитель проходят гейт; клиентская роль — нет', async () => {
    // Гейт пройден → дело доходит до чтения файла, и битый буфер даёт parse_failed.
    const passed = await previewPaymentImport(prisma, managerInCompany, {
      fileBuffer: Buffer.from('not a spreadsheet'),
      fileName: 'broken.xlsx',
    });
    expect(passed).toEqual({ ok: false, error: 'parse_failed' });
    // Руководитель проходит гейт; нечитаемый буфер → parse_failed.
    // ТЗ 2026-08-17 (PR-4): руководитель — top-level роль 'leader',
    // прежняя пара manager + managerRole='leader' снята вместе с колонкой.
    const leader = {
      ...(managerInCompany as object),
      role: 'leader',
    } as never;
    const res = await previewPaymentImport(prisma, leader, {
      fileBuffer: Buffer.from('not a spreadsheet'),
      fileName: 'broken.xlsx',
    });
    expect(res).toEqual({ ok: false, error: 'parse_failed' });
  });
});

describe('commitPaymentImport (cov)', () => {
  it('denies non-staff (organization) role', async () => {
    const res = await commitPaymentImport(prisma, orgSession, {
      fileBuffer: Buffer.from(''),
      fileName: 'x.xlsx',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('maps an unreadable file to parse_failed', async () => {
    const res = await commitPaymentImport(prisma, adminSession, {
      fileBuffer: Buffer.from('not a spreadsheet'),
      fileName: 'broken.xlsx',
    });
    expect(res).toEqual({ ok: false, error: 'parse_failed' });
  });

  it('maps a card with no operation rows to empty', async () => {
    // No «Сальдо на начало» marker → parseAccountCard returns [] → totalRows 0.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Лист1');
    ws.addRow(['просто заголовок без маркеров']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await commitPaymentImport(prisma, adminSession, {
      fileBuffer: buf,
      fileName: 'headeronly.xlsx',
    });
    // У-58: вместе с отказом отдаётся диагностика — что система увидела.
    expect(res).toMatchObject({ ok: false, error: 'empty' });
    const diagnostics = (res as { diagnostics?: { notes: string[] } }).diagnostics;
    expect(diagnostics?.notes.join(' ')).toContain('не карточка счёта 51');
  });

  it('commits: exact→Payment (incl. refund), queue, excluded, parse-error; best-effort sinks swallow failures', async () => {
    const buf = await commitBuffer();
    const res = await commitPaymentImport(prisma, adminSession, {
      fileBuffer: buf,
      fileName: 'card.xlsx',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.counts.totalRows).toBe(5);
      expect(res.result.counts.imported).toBe(2);
      expect(res.result.counts.refunds).toBe(1);
      expect(res.result.counts.queued).toBe(1);
      expect(res.result.counts.excluded).toBe(1);
      expect(res.result.counts.excludedByReason.supplier).toBe(1);
      expect(res.result.counts.parseErrors).toBe(1);
      // Создавать было не из чего → организаций импорт не заводил (`У-86`).
      expect(res.result.counts.orgsCreated).toBe(0);
    }
    // Строка без реквизитов не потеряна — она в очереди ручного разбора.
    const queued = await prisma.paymentImportRow.findUnique({
      where: { externalId: '0000-000703' },
      select: { status: true, counterpartyName: true },
    });
    expect(queued?.status).toBe('needs_review');
    expect(queued?.counterpartyName).toBeNull();
    // exact rows materialised as Payments (mocked S3/log/audit did not block them).
    const pay = await prisma.payment.findUnique({
      where: { externalId: '0000-000701' },
      select: { organizationId: true, isRefund: true },
    });
    expect(pay?.organizationId).toBe(orgWithInnId);
    expect(pay?.isRefund).toBe(false);
    const refund = await prisma.payment.findUnique({
      where: { externalId: '0000-000702' },
      select: { isRefund: true },
    });
    expect(refund?.isRefund).toBe(true);
    // best-effort sinks were invoked and their rejections swallowed.
    expect(uploadThrows).toHaveBeenCalled();
    // fileKey never persisted because the S3 upload threw before the update.
    const batch = await prisma.paymentImportBatch.findFirst({
      where: { importedById: 'cov-import-admin', fileName: 'card.xlsx' },
      orderBy: { createdAt: 'desc' },
      select: { fileKey: true },
    });
    expect(batch?.fileKey).toBeNull();
  });
});

describe('listQueue (cov)', () => {
  it('returns [] for a non-staff role', async () => {
    // `У-90`: сервис отдаёт страницу со счётчиком, а не голый массив.
    expect(await listQueue(prisma, orgSession)).toEqual({ rows: [], total: 0 });
  });

  it('admin sees needs_review rows unscoped by company', async () => {
    const { rows } = await listQueue(prisma, adminSession);
    const ids = rows.map((r) => r.externalId);
    expect(ids).toContain(ROW_EXT.scope);
    expect(ids).not.toContain(ROW_EXT.resolved);
  });

  it('manager is scoped to its own company batches', async () => {
    const { rows } = await listQueue(prisma, managerInCompany);
    expect(rows.every((r) => typeof r.id === 'string')).toBe(true);
    expect(rows.map((r) => r.externalId)).toContain(ROW_EXT.scope);
  });

  it('manager without a company matches the __none__ sentinel → no rows', async () => {
    const { rows } = await listQueue(prisma, managerNoCompany);
    expect(rows.map((r) => r.externalId)).not.toContain(ROW_EXT.scope);
  });
});

describe('resolveQueueRow (cov)', () => {
  it('denies a non-staff role', async () => {
    const res = await resolveQueueRow(prisma, orgSession, {
      rowId: 'whatever',
      organizationId: orgWithInnId,
      orderId: null,
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns not_found for an unknown row id', async () => {
    const res = await resolveQueueRow(prisma, adminSession, {
      rowId: 'no-such-row',
      organizationId: orgWithInnId,
      orderId: null,
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns not_found for a row that is not needs_review', async () => {
    const row = await prisma.paymentImportRow.findUnique({
      where: { externalId: ROW_EXT.resolved },
      select: { id: true },
    });
    const res = await resolveQueueRow(prisma, adminSession, {
      rowId: row!.id,
      organizationId: orgWithInnId,
      orderId: null,
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns not_found when a manager is in a different company (companyId mismatch)', async () => {
    const row = await prisma.paymentImportRow.findUnique({
      where: { externalId: ROW_EXT.scope },
      select: { id: true },
    });
    const res = await resolveQueueRow(prisma, managerOtherCompany, {
      rowId: row!.id,
      organizationId: orgWithInnId,
      orderId: null,
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns not_found when a manager has no company at all (fail-safe scope)', async () => {
    const row = await prisma.paymentImportRow.findUnique({
      where: { externalId: ROW_EXT.scope },
      select: { id: true },
    });
    const res = await resolveQueueRow(prisma, managerNoCompany, {
      rowId: row!.id,
      organizationId: orgWithInnId,
      orderId: null,
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns org_required when organizationId is empty', async () => {
    const row = await prisma.paymentImportRow.findUnique({
      where: { externalId: ROW_EXT.orgReq },
      select: { id: true },
    });
    const res = await resolveQueueRow(prisma, adminSession, {
      rowId: row!.id,
      organizationId: '',
      orderId: null,
    });
    expect(res).toEqual({ ok: false, error: 'org_required' });
  });

  it('returns not_found when the chosen organization does not exist', async () => {
    const row = await prisma.paymentImportRow.findUnique({
      where: { externalId: ROW_EXT.orgMissing },
      select: { id: true },
    });
    const res = await resolveQueueRow(prisma, adminSession, {
      rowId: row!.id,
      organizationId: 'no-such-org',
      orderId: null,
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('builds a null-field org-level DTO; writer skips a ref-less org → write_skipped', async () => {
    // rowA: no purpose/paymentOrderNumber/vatAmount, not a refund; org has no inn
    // & no externalId → resolveOrganizationRef returns null → Payment not created.
    const row = await prisma.paymentImportRow.findUnique({
      where: { externalId: ROW_EXT.a },
      select: { id: true },
    });
    const res = await resolveQueueRow(prisma, adminSession, {
      rowId: row!.id,
      organizationId: orgNullId,
      orderId: null,
    });
    expect(res).toEqual({ ok: false, error: 'write_skipped' });
    const still = await prisma.paymentImportRow.findUnique({
      where: { externalId: ROW_EXT.a },
      select: { status: true },
    });
    expect(still?.status).toBe('needs_review');
  });

  it('resolves org-level with all optional fields present → Payment created + row resolved', async () => {
    const row = await prisma.paymentImportRow.findUnique({
      where: { externalId: ROW_EXT.c },
      select: { id: true },
    });
    const res = await resolveQueueRow(prisma, adminSession, {
      rowId: row!.id,
      organizationId: orgWithInnId,
      orderId: null,
    });
    expect(res.ok).toBe(true);
    const pay = await prisma.payment.findUnique({
      where: { externalId: ROW_EXT.c },
      select: { organizationId: true },
    });
    expect(pay?.organizationId).toBe(orgWithInnId);
    const updated = await prisma.paymentImportRow.findUnique({
      where: { externalId: ROW_EXT.c },
      select: { status: true, resolvedPaymentId: true },
    });
    expect(updated?.status).toBe('resolved');
    expect(updated?.resolvedPaymentId).toBeTruthy();
  });

  it('resolves order-level (order has externalId, refund row) → Payment on the order', async () => {
    const row = await prisma.paymentImportRow.findUnique({
      where: { externalId: ROW_EXT.b },
      select: { id: true },
    });
    const res = await resolveQueueRow(prisma, adminSession, {
      rowId: row!.id,
      organizationId: orgWithInnId,
      orderId: orderWithExtId,
    });
    expect(res.ok).toBe(true);
    const pay = await prisma.payment.findUnique({
      where: { externalId: ROW_EXT.b },
      select: { orderId: true, isRefund: true },
    });
    expect(pay?.orderId).toBe(orderWithExtId);
    expect(pay?.isRefund).toBe(true);
  });
});

describe('dismissQueueRow (cov)', () => {
  it('denies a non-staff role', async () => {
    const res = await dismissQueueRow(prisma, orgSession, { rowId: 'whatever' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns not_found when a manager is out of company scope', async () => {
    const row = await prisma.paymentImportRow.findUnique({
      where: { externalId: ROW_EXT.scope },
      select: { id: true },
    });
    const res = await dismissQueueRow(prisma, managerOtherCompany, { rowId: row!.id });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('dismisses a needs_review row', async () => {
    const row = await prisma.paymentImportRow.findUnique({
      where: { externalId: ROW_EXT.dismiss },
      select: { id: true },
    });
    const res = await dismissQueueRow(prisma, adminSession, { rowId: row!.id });
    expect(res).toEqual({ ok: true });
    const updated = await prisma.paymentImportRow.findUnique({
      where: { externalId: ROW_EXT.dismiss },
      select: { status: true },
    });
    expect(updated?.status).toBe('dismissed');
  });
});

/** Один валидный exact-платёж (ИНН-match) — минимальная карточка для action-теста. */
async function oneRowBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Лист1');
  ws.addRow(['Сальдо на начало']);
  ws.addRow([
    '01.07.2026',
    'Поступление на расчетный счет 0000-000701 от 01.07.2026 10:00:00\nОплата',
    '',
    `КЛИЕНТ ООО ИНН ${INN}`,
    '',
    '18000',
    '',
    '62.01',
    '',
  ]);
  ws.addRow(['Обороты за период и сальдо на конец']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('payment-import server actions (cov)', () => {
  it('commitPaymentImportAction rejects a file over the size limit', async () => {
    requireSession.mockResolvedValue(adminSession);
    // Больше предела → guarded() отсекает файл до сервиса. Число берём из
    // константы (Т-5): раньше здесь было зашито 20 МБ, и подъём предела до 25
    // уронил тест в integration-гейте, хотя unit-слой был зелёным.
    const big = new File([new Uint8Array(IMPORT_MAX_FILE_BYTES + 1)], 'big.xlsx');
    const form = new FormData();
    form.set('file', big);
    const res = await commitPaymentImportAction(form);
    expect(res).toEqual({ ok: false, error: 'invalid_file' });
  });

  it('commitPaymentImportAction delegates a valid file to the service', async () => {
    requireSession.mockResolvedValue(adminSession);
    // non-Error S3 rejection this run → exercises the `: e` arm of the L106 log ternary.
    uploadThrows.mockRejectedValueOnce('s3 string failure');
    const buf = await oneRowBuffer();
    const form = new FormData();
    form.set('file', new File([new Uint8Array(buf)], 'action.xlsx'));
    const res = await commitPaymentImportAction(form);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.result.counts.imported).toBe(1);
  });

  it('resolveQueueRowAction delegates to the service with the session', async () => {
    requireSession.mockResolvedValue(adminSession);
    // unknown row id → service returns not_found; proves the wiring reaches the service.
    const res = await resolveQueueRowAction({
      rowId: 'action-no-row',
      organizationId: orgWithInnId,
      orderId: null,
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('dismissQueueRowAction delegates to the service with the session', async () => {
    requireSession.mockResolvedValue(adminSession);
    const res = await dismissQueueRowAction({ rowId: 'action-no-row' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});
