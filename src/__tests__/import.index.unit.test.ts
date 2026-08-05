/**
 * Unit tests for import/index.ts — covers the missing branches:
 * - previewImport/commitImport forbidden arm
 * - previewImport empty arm
 * - commitImport audit failure (non-blocking)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks
const { recordAudit, runRecordBatch, FileOneCAdapter, importScope } = vi.hoisted(() => {
  const runRecordBatch = vi.fn();
  const importScope = vi.fn().mockReturnValue({});
  const recordAudit = vi.fn().mockResolvedValue(undefined);
  const FileOneCAdapter = vi.fn().mockImplementation(() => ({
    pullOrganizations: vi.fn().mockResolvedValue([]),
    pullOrders: vi.fn().mockResolvedValue([]),
    pullPayments: vi.fn().mockResolvedValue([]),
    // Т-3: сервис обязан приложить диагностику к отчёту.
    diagnostics: vi.fn().mockResolvedValue({
      sheetsFound: ['Контрагенты'],
      sheetsExpected: ['Контрагенты', 'Реализации', 'Поступления'],
      unmatchedHeaders: { Контрагенты: ['КПП'] },
      missingColumns: {},
      duplicateSheets: {},
    }),
  }));
  return { recordAudit, runRecordBatch, FileOneCAdapter, importScope };
});

vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

// Т-2: пустой catch заменён на запись в журнал — проверяем, что она есть.
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { error: logError, warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/services/oneCSync/record-batch', () => ({ runRecordBatch }));
vi.mock('@/lib/services/oneCSync/adapter-file', () => ({ FileOneCAdapter }));
vi.mock('@/lib/services/oneCSync/scope', () => ({ importScope }));
vi.mock('@/lib/services/oneCSync/writers', () => ({
  upsertOrderRecord: vi.fn(),
  upsertOrgRecord: vi.fn(),
  upsertPaymentRecord: vi.fn(),
}));
vi.mock('@/lib/services/oneCSync/schemas', () => ({
  OneCOrderSchema: {},
  OneCOrgFileSchema: {},
  OneCPaymentSchema: {},
}));

import { previewImport, commitImport } from '@/lib/services/import/index';

const adminSession = { sub: 'u-admin', role: 'admin', companyId: 'c1' } as never;
const partnerSession = { sub: 'u-partner', role: 'partner' } as never;

const DIAGNOSTICS = {
  sheetsFound: ['Контрагенты'],
  sheetsExpected: ['Контрагенты', 'Реализации', 'Поступления'],
  unmatchedHeaders: { Контрагенты: ['КПП'] },
  missingColumns: {},
  duplicateSheets: {},
};

const fileBuffer = Buffer.from('fake-excel');
const fakePrisma = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: successful batch run with 1 order
  runRecordBatch
    .mockResolvedValueOnce({ pulled: 0, inserted: 0, updated: 0, errors: 0 }) // orgs (первым, Т-17)
    .mockResolvedValueOnce({ pulled: 1, inserted: 1, updated: 0, errors: 0 }) // orders
    .mockResolvedValueOnce({ pulled: 0, inserted: 0, updated: 0, errors: 0 }); // payments
});

describe('previewImport', () => {
  it('returns forbidden for non-staff roles (partner)', async () => {
    const result = await previewImport(fakePrisma, partnerSession, { fileBuffer });
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns forbidden for organization role', async () => {
    const orgSession = { sub: 'u-org', role: 'organization' } as never;
    const result = await previewImport(fakePrisma, orgSession, { fileBuffer });
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns parse_failed when adapter throws', async () => {
    // С этапа 3 диагностика зовётся ПЕРВОЙ (гард распознавания до записей) —
    // битый файл падает уже там.
    FileOneCAdapter.mockImplementationOnce(() => ({
      pullOrganizations: vi.fn(),
      pullOrders: vi.fn(),
      pullPayments: vi.fn(),
      diagnostics: vi.fn().mockRejectedValue(new Error('corrupt file')),
    }));
    const result = await previewImport(fakePrisma, adminSession, { fileBuffer });
    // Код ответа прежний, но причина больше не теряется — она в журнале (Т-2).
    expect(result).toEqual({ ok: false, error: 'parse_failed' });
    expect(logError).toHaveBeenCalledWith(
      '[1c-import] не удалось разобрать файл',
      expect.objectContaining({ message: 'corrupt file' })
    );
  });

  it('returns empty when both orders and payments pulled = 0', async () => {
    runRecordBatch.mockReset().mockResolvedValue({ pulled: 0, inserted: 0, updated: 0, errors: 0 });
    const result = await previewImport(fakePrisma, adminSession, { fileBuffer });
    // Диагностика приложена: именно в этой ветке она и нужна пользователю.
    expect(result).toEqual({ ok: false, error: 'empty', diagnostics: DIAGNOSTICS });
  });

  it('returns ok:true with report when orders > 0', async () => {
    const result = await previewImport(fakePrisma, adminSession, { fileBuffer });
    expect(result).toEqual({
      ok: true,
      report: {
        orgs: { pulled: 0, inserted: 0, updated: 0, errors: 0 },
        orders: { pulled: 1, inserted: 1, updated: 0, errors: 0 },
        payments: { pulled: 0, inserted: 0, updated: 0, errors: 0 },
        diagnostics: DIAGNOSTICS,
      },
    });
  });

  it('returns ok:true when only payments > 0', async () => {
    runRecordBatch
      .mockReset()
      .mockResolvedValueOnce({ pulled: 0, inserted: 0, updated: 0, errors: 0 }) // orgs
      .mockResolvedValueOnce({ pulled: 0, inserted: 0, updated: 0, errors: 0 }) // orders
      .mockResolvedValueOnce({ pulled: 2, inserted: 2, updated: 0, errors: 0 }); // payments
    const result = await previewImport(fakePrisma, adminSession, { fileBuffer });
    expect(result).toMatchObject({ ok: true });
  });

  it('runs in shadow mode (no writes to DB)', async () => {
    await previewImport(fakePrisma, adminSession, { fileBuffer });
    // importScope called once
    expect(importScope).toHaveBeenCalledWith(adminSession);
    // Т-17: три батча — организации, заказы, оплаты
    expect(runRecordBatch).toHaveBeenCalledTimes(3);
    // No audit in preview
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe('commitImport', () => {
  it('returns forbidden for non-staff roles', async () => {
    const result = await commitImport(fakePrisma, partnerSession, { fileBuffer });
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns parse_failed when run throws', async () => {
    FileOneCAdapter.mockImplementationOnce(() => ({
      pullOrganizations: vi.fn(),
      pullOrders: vi.fn(),
      pullPayments: vi.fn(),
      diagnostics: vi.fn().mockRejectedValue(new Error('bad')),
    }));
    const result = await commitImport(fakePrisma, adminSession, { fileBuffer });
    expect(result).toEqual({ ok: false, error: 'parse_failed' });
    expect(logError).toHaveBeenCalledWith(
      '[1c-import] не удалось разобрать файл',
      expect.objectContaining({ message: 'bad' })
    );
  });

  it('отказ по правам приходит без диагностики — файл даже не читался', async () => {
    const result = await commitImport(fakePrisma, partnerSession, { fileBuffer });
    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(result).not.toHaveProperty('diagnostics');
  });

  it('returns ok:true and writes audit log on success', async () => {
    const result = await commitImport(fakePrisma, adminSession, { fileBuffer });
    expect(result).toMatchObject({ ok: true });
    expect(recordAudit).toHaveBeenCalledOnce();
    expect(recordAudit.mock.calls[0][1]).toMatchObject({
      userId: 'u-admin',
      action: 'one_c_import.commit',
    });
    // Audit entity ID = companyId (when defined)
    expect(recordAudit.mock.calls[0][1].entityId).toBe('c1');
  });

  it('uses session.sub as entityId when companyId is null', async () => {
    // Branch: session.companyId ?? session.sub — covers null/undefined companyId case
    runRecordBatch
      .mockReset()
      .mockResolvedValueOnce({ pulled: 1, inserted: 1, updated: 0, errors: 0 })
      .mockResolvedValueOnce({ pulled: 0, inserted: 0, updated: 0, errors: 0 });
    const sessionNoCompany = { sub: 'u-mgr', role: 'manager', companyId: null } as never;
    const result = await commitImport(fakePrisma, sessionNoCompany, { fileBuffer });
    expect(result).toMatchObject({ ok: true });
    expect(recordAudit.mock.calls[0][1].entityId).toBe('u-mgr');
  });

  it('does NOT throw when audit recordAudit fails (non-blocking)', async () => {
    recordAudit.mockRejectedValueOnce(new Error('audit DB down'));
    const result = await commitImport(fakePrisma, adminSession, { fileBuffer });
    // Should still return ok:true — audit failure is swallowed
    expect(result).toMatchObject({ ok: true });
  });
});

/**
 * Этап 3 (Т-11/Т-12/Т-14): внятные отказы вместо «Файл пуст», и гарды
 * распознавания срабатывают ДО записей — иначе live-режим успел бы записать
 * распознанную половину файла.
 */
describe('этап 3 — коды распознавания', () => {
  const EMPTY_SUMMARY = { pulled: 0, created: 0, updated: 0, errors: 0 };

  function adapterWithDiagnostics(diagnostics: unknown) {
    const pullOrganizations = vi.fn().mockResolvedValue([]);
    const pullOrders = vi.fn().mockResolvedValue([]);
    const pullPayments = vi.fn().mockResolvedValue([]);
    FileOneCAdapter.mockImplementationOnce(() => ({
      pullOrganizations,
      pullOrders,
      pullPayments,
      diagnostics: vi.fn().mockResolvedValue(diagnostics),
    }));
    return { pullOrganizations, pullOrders, pullPayments };
  }

  it('ни один лист не распознан → sheets_not_recognized, записи не начинались', async () => {
    const { pullOrders } = adapterWithDiagnostics({
      sheetsFound: ['Лист1'],
      sheetsExpected: ['Контрагенты', 'Реализации', 'Поступления'],
      unmatchedHeaders: {},
      missingColumns: {},
      duplicateSheets: {},
    });
    const result = await commitImport(fakePrisma, adminSession, { fileBuffer });
    expect(result).toMatchObject({ ok: false, error: 'sheets_not_recognized' });
    expect((result as { diagnostics?: unknown }).diagnostics).toBeTruthy();
    expect(pullOrders).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('нет обязательной колонки → columns_not_recognized, записи не начинались', async () => {
    const { pullOrders } = adapterWithDiagnostics({
      sheetsFound: ['Поступления'],
      sheetsExpected: ['Контрагенты', 'Реализации', 'Поступления'],
      unmatchedHeaders: { Поступления: [] },
      missingColumns: { Поступления: ['Сумма', 'Дата'] },
      duplicateSheets: {},
    });
    const result = await commitImport(fakePrisma, adminSession, { fileBuffer });
    expect(result).toMatchObject({ ok: false, error: 'columns_not_recognized' });
    expect(pullOrders).not.toHaveBeenCalled();
  });

  it('содержимое не Excel → format_mismatch без записи в журнал ошибок разбора', async () => {
    const { WorkbookFormatError } = await import('@/lib/services/import/workbook');
    FileOneCAdapter.mockImplementationOnce(() => ({
      pullOrders: vi.fn(),
      pullPayments: vi.fn(),
      diagnostics: vi.fn().mockRejectedValue(new WorkbookFormatError()),
    }));
    const result = await previewImport(fakePrisma, adminSession, { fileBuffer });
    expect(result).toEqual({ ok: false, error: 'format_mismatch' });
    expect(logError).not.toHaveBeenCalled();
  });

  it('расхождение имени и содержимого попадает замечанием в диагностику (Т-14)', async () => {
    // Буфер начинается с PK → xlsx, а имя говорит .xls.
    const xlsxNamedXls = Buffer.from('PK\x03\x04фейковый-zip');
    runRecordBatch.mockReset().mockResolvedValue({ ...EMPTY_SUMMARY, pulled: 1 });
    const result = await previewImport(fakePrisma, adminSession, {
      fileBuffer: xlsxNamedXls,
      fileName: 'выгрузка.xls',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.diagnostics.formatNote).toContain('выгрузка.xls');
      expect(result.report.diagnostics.formatNote).toContain('.xlsx');
    }
  });

  it('замечание для содержимого-.xls под именем .xlsx — вторая ветка текста', async () => {
    const oleBuffer = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00]);
    runRecordBatch.mockReset().mockResolvedValue({ ...EMPTY_SUMMARY, pulled: 1 });
    const result = await previewImport(fakePrisma, adminSession, {
      fileBuffer: oleBuffer,
      fileName: 'выгрузка.xlsx',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.diagnostics.formatNote).toContain('старый формат .xls');
    }
  });

  it('батчи упали ПОСЛЕ успешной диагностики → parse_failed с записью в журнал', async () => {
    FileOneCAdapter.mockImplementationOnce(() => ({
      pullOrganizations: vi.fn().mockResolvedValue([]),
      pullOrders: vi.fn().mockRejectedValue(new Error('db exploded')),
      pullPayments: vi.fn(),
      diagnostics: vi.fn().mockResolvedValue({
        sheetsFound: ['Контрагенты'],
        sheetsExpected: ['Контрагенты', 'Реализации', 'Поступления'],
        unmatchedHeaders: { Контрагенты: [] },
        missingColumns: {},
        duplicateSheets: {},
      }),
    }));
    const result = await previewImport(fakePrisma, adminSession, { fileBuffer });
    expect(result).toEqual({ ok: false, error: 'parse_failed' });
    expect(logError).toHaveBeenCalledWith(
      '[1c-import] не удалось разобрать файл',
      expect.objectContaining({ message: 'db exploded' })
    );
  });

  it('совпадающее расширение замечания не даёт', async () => {
    runRecordBatch.mockReset().mockResolvedValue({ ...EMPTY_SUMMARY, pulled: 1 });
    const result = await previewImport(fakePrisma, adminSession, {
      fileBuffer: Buffer.from('PK\x03\x04фейковый-zip'),
      fileName: 'выгрузка.xlsx',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report.diagnostics.formatNote).toBeUndefined();
  });
});
