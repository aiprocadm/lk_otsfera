/**
 * Integration test: unified ingestion contract
 *
 * Verifies that Excel-sourced orders/payments and API-sourced ones produce
 * IDENTICAL domain rows, and that manager scope is correctly enforced.
 *
 * Auto-detected as integration (contains `new PrismaClient(`) → runs via
 * `npm run test:integration` against a live Postgres.
 *
 * Uses unique prefix `t15-` for all externalIds/inns/slugs to avoid
 * cross-test collision in the shared database.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { commitImport } from '@/lib/services/import';
import {
  upsertOrderRecord,
  upsertPaymentRecord,
  type WriteCtx,
} from '@/lib/services/oneCSync/writers';
import { importScope } from '@/lib/services/oneCSync/scope';
import { emptySummary } from '@/lib/services/oneCSync/record-batch';

// ── mock parse-workbook BEFORE any import that would load FileOneCAdapter ────
// vi.hoisted ensures the mock factory runs before module-level code.
const { mockParseWorkbook } = vi.hoisted(() => ({
  mockParseWorkbook: vi.fn(),
}));

vi.mock('@/lib/services/import/parse-workbook', () => ({
  parseWorkbook: mockParseWorkbook,
}));

// ── constants ────────────────────────────────────────────────────────────────
const PREFIX = 't15-';

// Org seed data
const ORG_EXT_ID = `${PREFIX}org-ext-1`;
const ORG_INN = `${PREFIX}7701234567`;
const PARTNER_SLUG = `${PREFIX}partner-slug`;
const PARTNER_INN = `${PREFIX}partner-inn`;

// Excel-sourced order (resolved by INN)
const EXCEL_ORDER_EXT = `${PREFIX}order-excel-1`;
const EXCEL_PAY_EXT = `${PREFIX}pay-excel-1`;

// API-sourced order (resolved by organizationExternalId)
const API_ORDER_EXT = `${PREFIX}order-api-1`;
const API_PAY_EXT = `${PREFIX}pay-api-1`;

// Manager-scope test order
const SCOPE_ORDER_EXT = `${PREFIX}order-scope-1`;

const EPOCH = new Date(0).toISOString();
const PAID_AT = '2024-01-15T10:00:00.000Z';

// ── prisma ───────────────────────────────────────────────────────────────────
let prisma: PrismaClient;

// ── seeded IDs (populated in beforeAll) ──────────────────────────────────────
let partnerId: string;
let companyId: string;
let orgId: string;

// ── sessions ─────────────────────────────────────────────────────────────────
const adminSession: SessionPayload = {
  sub: `${PREFIX}admin-user`,
  role: 'admin',
};

// Руководитель ЧУЖОЙ компании — company-скоуп не должен видеть наш seeded org (C8).
// (Обычный менеджер с этапа 7 отбивается раньше — mayImportOneC, Т-25.)
function buildForeignLeaderSession(otherCompanyId: string): SessionPayload {
  return {
    sub: `${PREFIX}leader-user`,
    role: 'leader',
    companyId: otherCompanyId,
    managedOrgIds: [],
  } as SessionPayload;
}

// ── teardown helpers (FK-order matters) ─────────────────────────────────────
async function cleanupOrders(externalIds: string[]) {
  const orders = await prisma.order.findMany({
    where: { externalId: { in: externalIds } },
    select: { id: true },
  });
  const ids = orders.map((o) => o.id);
  if (ids.length) {
    await prisma.commissionStatementItem.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.comment.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.upload.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.document.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { id: { in: ids } } });
  }
}

async function cleanupPayments(externalIds: string[]) {
  await prisma.payment.deleteMany({ where: { externalId: { in: externalIds } } });
}

async function fullTeardown() {
  // Payments and orders first (FK children)
  await cleanupPayments([EXCEL_PAY_EXT, API_PAY_EXT]);
  await cleanupOrders([EXCEL_ORDER_EXT, API_ORDER_EXT, SCOPE_ORDER_EXT]);

  // Org children
  if (orgId) {
    await prisma.organizationUser.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationManager.deleteMany({ where: { organizationId: orgId } });
    await prisma.student.deleteMany({ where: { organizationId: orgId } });
    await prisma.notification.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  }

  // Org with PREFIX inn (stale guard)
  await prisma.organization.deleteMany({ where: { inn: ORG_INN } });

  if (companyId) {
    await prisma.company.deleteMany({ where: { id: companyId } });
  }

  if (partnerId) {
    await prisma.partnerUser.deleteMany({ where: { partnerId } });
    await prisma.notification.deleteMany({ where: { partnerId } });
    await prisma.partner.deleteMany({ where: { id: partnerId } });
  }

  // Audit logs written by admin session (non-blocking cleanup)
  await prisma.auditLog.deleteMany({ where: { userId: adminSession.sub } }).catch(() => undefined);
}

// ── setup ─────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  prisma = new PrismaClient();

  // Guard: clean up any stale rows from a previous failed run.
  await fullTeardown();

  // Seed: Company → Partner → Organization (linked by INN + externalId).
  const company = await prisma.company.create({ data: { name: `${PREFIX}Company` } });
  companyId = company.id;

  const partner = await prisma.partner.create({
    data: {
      name: `${PREFIX}Partner`,
      slug: PARTNER_SLUG,
      inn: PARTNER_INN,
      commissionRate: 0.1,
    },
  });
  partnerId = partner.id;

  const org = await prisma.organization.create({
    data: {
      name: `${PREFIX}Org`,
      externalId: ORG_EXT_ID,
      inn: ORG_INN,
      partnerId,
      companyId,
    },
  });
  orgId = org.id;
});

afterAll(async () => {
  await fullTeardown();
  await prisma.$disconnect();
});

// ── Test 1: Excel path (INN resolution) ─────────────────────────────────────
describe('Test 1 — Excel import attaches order to org by INN', () => {
  it('writes order with correct financialStatus, partnerId, companyId, organizationId', async () => {
    // Arrange: mock parse-workbook to return one order (totalAmount=paidAmount → 'paid')
    // and one linked payment.
    mockParseWorkbook.mockResolvedValueOnce({
      orgs: [],
      orders: [
        {
          externalId: EXCEL_ORDER_EXT,
          orderNumber: 'ORD-EXCEL-001',
          orgInn: ORG_INN,
          totalAmount: 100,
          paidAmount: 100,
        },
      ],
      payments: [
        {
          externalId: EXCEL_PAY_EXT,
          orgInn: ORG_INN,
          amount: 100,
          paidAt: PAID_AT,
          method: 'bank',
          note: null,
          orderRef: EXCEL_ORDER_EXT, // linked to the order by externalId ref
        },
      ],
      // Этап 3: сервис требует диагностику с распознанными листами (гард Т-11/Т-12).
      diagnostics: {
        sheetsFound: ['Реализации', 'Поступления'],
        sheetsExpected: ['Контрагенты', 'Реализации', 'Поступления'],
        unmatchedHeaders: { Реализации: [], Поступления: [] },
        missingColumns: {},
        duplicateSheets: {},
      },
    });

    // Act: fileBuffer can be anything — parse-workbook is mocked.
    // Т-41: admin (глобальный скоуп) обязан назвать компанию — в общей базе их много.
    const result = await commitImport(prisma, adminSession, {
      fileBuffer: Buffer.from('x'),
      companyId,
    });

    // Assert: import succeeded
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.orders.created).toBe(1);
    expect(result.report.orders.skipped).toBe(0);
    expect(result.report.payments.created).toBe(1);

    // Assert DB: order exists with correct fields
    const order = await prisma.order.findUnique({
      where: { externalId: EXCEL_ORDER_EXT },
      select: {
        financialStatus: true,
        partnerId: true,
        companyId: true,
        organizationId: true,
      },
    });
    expect(order).not.toBeNull();
    expect(order!.financialStatus).toBe('paid');
    expect(order!.partnerId).toBe(partnerId);
    expect(order!.companyId).toBe(companyId);
    expect(order!.organizationId).toBe(orgId);

    // Assert DB: payment is linked to the order
    const payment = await prisma.payment.findUnique({
      where: { externalId: EXCEL_PAY_EXT },
      select: { orderId: true, organizationId: true },
    });
    expect(payment).not.toBeNull();
    expect(payment!.orderId).toBeTruthy(); // linked via orderRef
    expect(payment!.organizationId).toBe(orgId);
  });
});

// ── Test 2: Parity — API writer produces identical domain fields ─────────────
describe('Test 2 — API writer (upsertOrderRecord) produces identical domain fields', () => {
  it('order created via API path matches Excel-path fields for financialStatus/partnerId/companyId/organizationId', async () => {
    // Arrange: a DTO using organizationExternalId (API-path key).
    const apiOrderDto = {
      externalId: API_ORDER_EXT,
      orderNumber: 'ORD-API-001',
      title: 'ORD-API-001',
      organizationExternalId: ORG_EXT_ID, // resolved by externalId, not INN
      totalAmount: 100,
      paidAmount: 100,
      vatIncluded: true,
      executionStatus: 'pending' as const,
      financialStatus: 'paid' as const,
      productMix: [],
      updatedAt: EPOCH,
    };

    const ctx: WriteCtx = { mode: 'live', notify: false, scope: importScope(adminSession) };
    const summary = emptySummary();
    await upsertOrderRecord(prisma, apiOrderDto, summary, ctx);

    expect(summary.created).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.failed).toBe(0);

    // Assert DB: API-created order
    const apiOrder = await prisma.order.findUnique({
      where: { externalId: API_ORDER_EXT },
      select: {
        financialStatus: true,
        partnerId: true,
        companyId: true,
        organizationId: true,
      },
    });
    expect(apiOrder).not.toBeNull();

    // Assert DB: Excel-created order (from Test 1) — compare field-by-field
    const excelOrder = await prisma.order.findUnique({
      where: { externalId: EXCEL_ORDER_EXT },
      select: {
        financialStatus: true,
        partnerId: true,
        companyId: true,
        organizationId: true,
      },
    });
    expect(excelOrder).not.toBeNull();

    // Parity assertion: both paths must produce identical domain fields
    expect(apiOrder!.financialStatus).toBe(excelOrder!.financialStatus);
    expect(apiOrder!.partnerId).toBe(excelOrder!.partnerId);
    expect(apiOrder!.companyId).toBe(excelOrder!.companyId);
    expect(apiOrder!.organizationId).toBe(excelOrder!.organizationId);
  });

  it('org-level payment created via API path links to correct organization', async () => {
    // Payment using organizationExternalId (no orderRef) — org-level payment.
    const apiPayDto = {
      externalId: API_PAY_EXT,
      organizationExternalId: ORG_EXT_ID,
      amount: 50,
      paidAt: PAID_AT,
      isRefund: false,
      updatedAt: EPOCH,
    };

    const ctx: WriteCtx = { mode: 'live', notify: false, scope: importScope(adminSession) };
    const summary = emptySummary();
    await upsertPaymentRecord(prisma, apiPayDto, summary, ctx);

    expect(summary.created).toBe(1);

    const pay = await prisma.payment.findUnique({
      where: { externalId: API_PAY_EXT },
      select: { organizationId: true, orderId: true },
    });
    expect(pay).not.toBeNull();
    expect(pay!.organizationId).toBe(orgId);
    expect(pay!.orderId).toBeNull(); // org-level, not order-linked
  });
});

// ── Test 3: права (Т-25) и скоуп (C8) ────────────────────────────────────────
describe('Test 3 — права штата и скоуп: чужой руководитель скипает out_of_scope', () => {
  it('commitImport: менеджер проходит право; чужому руководителю — skip out_of_scope', async () => {
    // Sentinel-компания и организация: дом «чужого» руководителя.
    const otherCompany = await prisma.company.create({ data: { name: `${PREFIX}OtherCompany` } });
    const otherOrg = await prisma.organization.create({
      data: {
        name: `${PREFIX}OtherOrg`,
        partnerId,
        companyId: otherCompany.id,
      },
    });

    try {
      // Решение заказчика 11.08.2026 отменило `Т-25`: обычный менеджер проходит
      // порог сервиса, поэтому битый буфер даёт parse_failed, а не forbidden.
      // Границу его возможностей держит скоуп (свои организации, без создания
      // новых) — это проверяет соседний блок про out_of_scope.
      const plainManager: SessionPayload = {
        sub: `${PREFIX}manager-user`,
        role: 'manager',
        managedOrgIds: [otherOrg.id],
      };
      const passed = await commitImport(prisma, plainManager, { fileBuffer: Buffer.from('x') });
      expect(passed).toMatchObject({ ok: false, error: 'parse_failed' });

      const managerSession = buildForeignLeaderSession(otherCompany.id);

      // Mock parse-workbook: same order targeting our seeded org by INN.
      mockParseWorkbook.mockResolvedValueOnce({
        orgs: [],
        orders: [
          {
            externalId: SCOPE_ORDER_EXT,
            orderNumber: 'ORD-SCOPE-001',
            orgInn: ORG_INN,
            totalAmount: 200,
            paidAmount: 0,
          },
        ],
        payments: [],
        // Этап 3: сервис требует диагностику с распознанными листами (гард Т-11/Т-12).
        diagnostics: {
          sheetsFound: ['Реализации', 'Поступления'],
          sheetsExpected: ['Контрагенты', 'Реализации', 'Поступления'],
          unmatchedHeaders: { Реализации: [], Поступления: [] },
          missingColumns: {},
          duplicateSheets: {},
        },
      });

      const result = await commitImport(prisma, managerSession, { fileBuffer: Buffer.from('x') });

      // Сам импорт руководителю разрешён (Т-25) — режет только скоуп.
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The order must have been skipped due to scope
      expect(result.report.orders.skipped).toBeGreaterThanOrEqual(1);
      const skipReasons = result.report.orders.skips.map((s) => s.reason);
      expect(skipReasons).toContain('out_of_scope');

      // No DB row must exist for the scoped-out order
      const dbOrder = await prisma.order.findUnique({
        where: { externalId: SCOPE_ORDER_EXT },
      });
      expect(dbOrder).toBeNull();
    } finally {
      // Teardown sentinel org (order was never created, so only org/company cleanup)
      await prisma.organization.deleteMany({ where: { id: otherOrg.id } });
      await prisma.company.deleteMany({ where: { id: otherCompany.id } });
    }
  });
});
