// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import AdminCommissionStatementDetailPage from '@/app/admin/commission-statements/[id]/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getAdminStatement, getStatementAuditLog } = vi.hoisted(() => ({
  getAdminStatement: vi.fn(),
  getStatementAuditLog: vi.fn(),
}));
vi.mock('@/lib/services/admin/commissionStatements', () => ({
  getAdminStatement,
  getStatementAuditLog,
}));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/admin/mark-paid-form', () => ({
  MarkPaidForm: (props: { statementId: string; status: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'mark-paid-form' },
      props.statementId,
      props.status
    ),
}));

const SESSION = { sub: 'admin1', role: 'admin' as const };

const BASE_STATEMENT = {
  id: 'st1',
  partner: { name: 'Партнёр' },
  periodFrom: new Date('2024-01-01'),
  periodTo: new Date('2024-01-31'),
  status: 'approved',
  totalBaseAmount: '1000',
  totalCommissionAmount: '100',
  paidAt: null,
  pdfPath: null,
  xlsxPath: null,
  items: [],
};

describe('AdminCommissionStatementDetailPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    getAdminStatement.mockReset();
    getStatementAuditLog.mockReset();
    nav.notFound.mockClear();
  });

  it('calls notFound() when statement is missing', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getAdminStatement.mockResolvedValue(null);
    getStatementAuditLog.mockResolvedValue([]);

    await expect(
      renderServerComponent(
        AdminCommissionStatementDetailPage({ params: Promise.resolve({ id: 'missing' }) })
      )
    ).rejects.toThrow('NOT_FOUND');
  });

  it('renders statement with pdf/xlsx links, paidAt set, and audit entries with known action label', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getAdminStatement.mockResolvedValue({
      ...BASE_STATEMENT,
      paidAt: new Date('2024-02-01'),
      pdfPath: '/x.pdf',
      xlsxPath: '/x.xlsx',
      items: [
        {
          id: 'i1',
          orderNumber: '2024-001',
          organizationName: 'Org',
          baseAmount: '500',
          rate: '0.1',
          commissionAmount: '50',
        },
        {
          id: 'i2',
          orderNumber: null,
          organizationName: 'Org 2',
          baseAmount: '300',
          rate: '0.05',
          commissionAmount: '15',
        },
      ],
    });
    getStatementAuditLog.mockResolvedValue([
      {
        id: 'a1',
        action: 'commission_statement_approved',
        userName: 'Иванов',
        createdAt: new Date('2024-01-02'),
      },
    ]);

    const { container } = await renderServerComponent(
      AdminCommissionStatementDetailPage({ params: Promise.resolve({ id: 'st1' }) })
    );

    expect(getAdminStatement).toHaveBeenCalledWith({}, 'st1');
    expect(getStatementAuditLog).toHaveBeenCalledWith({}, 'st1');
    expect(container.textContent).toContain('Партнёр');
    expect(container.textContent).toContain('Скачать PDF');
    expect(container.textContent).toContain('Скачать XLSX');
    expect(container.textContent).toContain('Утверждён');
    expect(container.textContent).toContain('2024-001');
    expect(container.textContent).toContain('Иванов');
  });

  it('renders empty items/audit states, no pdf/xlsx links, unknown audit action label falls back to raw action, userName fallback to userId', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getAdminStatement.mockResolvedValue({ ...BASE_STATEMENT, status: 'weird_status' });
    getStatementAuditLog.mockResolvedValue([
      {
        id: 'a2',
        action: 'unknown_action',
        userName: null,
        userId: 'u9',
        createdAt: new Date('2024-01-03'),
      },
    ]);

    const { container } = await renderServerComponent(
      AdminCommissionStatementDetailPage({ params: Promise.resolve({ id: 'st1' }) })
    );

    expect(container.textContent).not.toContain('Скачать PDF');
    expect(container.textContent).not.toContain('Скачать XLSX');
    expect(container.textContent).toContain('Нет позиций');
    expect(container.textContent).toContain('unknown_action');
    expect(container.textContent).toContain('u9');
    expect(container.textContent).toContain('weird_status');
  });

  it('renders "Записей пока нет" when audit log is empty', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getAdminStatement.mockResolvedValue(BASE_STATEMENT);
    getStatementAuditLog.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      AdminCommissionStatementDetailPage({ params: Promise.resolve({ id: 'st1' }) })
    );

    expect(container.textContent).toContain('Записей пока нет');
  });

  it('renders a cross-month period label (fmtPeriod fallback branch) when periodFrom/periodTo span different months', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getAdminStatement.mockResolvedValue({
      ...BASE_STATEMENT,
      periodFrom: new Date('2024-01-15'),
      periodTo: new Date('2024-02-15'),
    });
    getStatementAuditLog.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      AdminCommissionStatementDetailPage({ params: Promise.resolve({ id: 'st1' }) })
    );

    expect(container.textContent).toMatch(/\d{2}\.\d{2}\.\d{4}\s*—\s*\d{2}\.\d{2}\.\d{4}/);
  });
});
