/**
 * Unit tests for import/index.ts — covers the missing branches:
 * - previewImport/commitImport forbidden arm
 * - previewImport empty arm
 * - commitImport audit failure (non-blocking)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
// Этап 8: результат writer-а собирается в историю — мок доступен по имени.
const { upsertOrgRecordMock } = vi.hoisted(() => ({ upsertOrgRecordMock: vi.fn() }));
vi.mock('@/lib/services/oneCSync/writers', () => ({
  upsertOrderRecord: vi.fn(),
  upsertOrgRecord: upsertOrgRecordMock,
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

  it('Т-25: обычный менеджер (без суб-роли leader) → forbidden, файл не разбирается', async () => {
    const plainManager = { sub: 'u-m', role: 'manager', managedOrgIds: [] } as never;
    const result = await previewImport(fakePrisma, plainManager, { fileBuffer });
    expect(result).toEqual({ ok: false, error: 'forbidden' });
    const denied = await commitImport(fakePrisma, plainManager, { fileBuffer });
    expect(denied).toEqual({ ok: false, error: 'forbidden' });
    expect(runRecordBatch).not.toHaveBeenCalled();
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
    // Т-25: обычный менеджер импорт больше не запускает — сессия руководителя
    // (без companyId право сохраняется, скоуп деградирует отдельно).
    const sessionNoCompany = {
      sub: 'u-mgr',
      role: 'manager',
      managerRole: 'leader',
      companyId: null,
    } as never;
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

/**
 * Этап 6 (Т-41): admin (скоуп global, Model A — своей компании нет) обязан
 * назвать компанию для НОВЫХ организаций. Проверка идёт ДО батчей и одинакова
 * в предпросмотре и применении. Руководителю/менеджеру компанию задаёт скоуп —
 * их путь эти ветки не трогают (скоуп в этом файле замокан на {}).
 */
describe('этап 6 — компания для новых организаций (Т-41, скоуп global)', () => {
  afterEach(() => {
    importScope.mockReturnValue({});
  });

  it('передана и существует → проверена по базе, импорт идёт', async () => {
    importScope.mockReturnValue({ kind: 'global' });
    const findUnique = vi.fn().mockResolvedValue({ id: 'co-42' });
    const result = await previewImport({ company: { findUnique } } as never, adminSession, {
      fileBuffer,
      companyId: 'co-42',
    });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'co-42' }, select: { id: true } });
    expect(result.ok).toBe(true);
  });

  it('передана, но в базе такой нет → company_required с диагностикой, батчи не начинались', async () => {
    importScope.mockReturnValue({ kind: 'global' });
    const findUnique = vi.fn().mockResolvedValue(null);
    const result = await commitImport({ company: { findUnique } } as never, adminSession, {
      fileBuffer,
      companyId: 'co-ghost',
    });
    expect(result).toMatchObject({ ok: false, error: 'company_required' });
    expect((result as { diagnostics?: unknown }).diagnostics).toBeTruthy();
    expect(runRecordBatch).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('не передана, компания в системе одна → берётся по умолчанию, без вопроса', async () => {
    importScope.mockReturnValue({ kind: 'global' });
    const findMany = vi.fn().mockResolvedValue([{ id: 'co-only' }]);
    const result = await previewImport({ company: { findMany } } as never, adminSession, {
      fileBuffer,
    });
    expect(findMany).toHaveBeenCalledWith({ select: { id: true }, take: 2 });
    expect(result.ok).toBe(true);
  });

  it('не передана, компаний несколько → company_required ДО батчей', async () => {
    importScope.mockReturnValue({ kind: 'global' });
    const findMany = vi.fn().mockResolvedValue([{ id: 'co-1' }, { id: 'co-2' }]);
    const result = await previewImport({ company: { findMany } } as never, adminSession, {
      fileBuffer,
    });
    expect(result).toMatchObject({ ok: false, error: 'company_required' });
    expect(runRecordBatch).not.toHaveBeenCalled();
  });
});

/**
 * Этап 8 (Т-32/Т-33): история импорта. Батч пишется после успешного live-прогона;
 * предпросмотр историю не ведёт; отказ записи — non-blocking (§4.4 спеки).
 */
describe('этап 8 — история импорта (Т-33)', () => {
  const EMPTY = { pulled: 0, created: 0, updated: 0, skipped: 0, invalid: 0, failed: 0 };
  function historyPrisma() {
    return {
      oneCImportBatch: { create: vi.fn().mockResolvedValue({ id: 'batch-1' }) },
      oneCImportRow: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    } as never;
  }

  it('commitImport пишет батч (кто/файл/счётчики/статус) и строки из результатов writer-ов', async () => {
    const prisma = historyPrisma();
    // runRecordBatch зовёт обработчик — результат writer-а попадает в строки истории.
    upsertOrgRecordMock
      .mockResolvedValueOnce({
        entityId: 'org-1',
        action: 'updated',
        before: { name: 'Старое' },
      })
      .mockResolvedValueOnce({ entityId: 'org-2', action: 'created' });
    runRecordBatch
      .mockReset()
      .mockImplementationOnce(async (_raw: unknown[], _s: never, _g: never, handler: never) => {
        const h = handler as (r: unknown, s: unknown) => Promise<void>;
        await h({ externalId: 'x' }, {});
        await h({ externalId: 'y' }, {});
        return { ...EMPTY, pulled: 2, updated: 1, created: 1 };
      })
      .mockResolvedValueOnce({ ...EMPTY, pulled: 0 })
      .mockResolvedValueOnce({ ...EMPTY, pulled: 0 });

    const result = await commitImport(prisma, adminSession, {
      fileBuffer,
      fileName: 'история.xlsx',
    });
    expect(result).toMatchObject({ ok: true });

    const batchArg = (prisma as { oneCImportBatch: { create: ReturnType<typeof vi.fn> } })
      .oneCImportBatch.create.mock.calls[0][0];
    expect(batchArg.data).toMatchObject({
      importedById: 'u-admin',
      fileName: 'история.xlsx',
      status: 'committed',
    });
    expect(batchArg.data.counts.orgs).toMatchObject({ pulled: 2, updated: 1, created: 1 });

    const rowsArg = (prisma as { oneCImportRow: { createMany: ReturnType<typeof vi.fn> } })
      .oneCImportRow.createMany.mock.calls[0][0];
    expect(rowsArg.data).toEqual([
      {
        batchId: 'batch-1',
        entity: 'organization',
        entityId: 'org-1',
        action: 'updated',
        before: { name: 'Старое' },
      },
      // created — без before (снимок только у updated, Т-33).
      {
        batchId: 'batch-1',
        entity: 'organization',
        entityId: 'org-2',
        action: 'created',
      },
    ]);
  });

  it('previewImport историю НЕ пишет', async () => {
    const prisma = historyPrisma();
    const result = await previewImport(prisma, adminSession, { fileBuffer });
    expect(result).toMatchObject({ ok: true });
    expect(
      (prisma as { oneCImportBatch: { create: ReturnType<typeof vi.fn> } }).oneCImportBatch.create
    ).not.toHaveBeenCalled();
  });

  it('отказ записи истории не роняет применённый импорт: ok + log.error (§4.4)', async () => {
    const prisma = {
      oneCImportBatch: { create: vi.fn().mockRejectedValue(new Error('history db down')) },
      oneCImportRow: { createMany: vi.fn() },
    } as never;
    const result = await commitImport(prisma, adminSession, { fileBuffer });
    expect(result).toMatchObject({ ok: true });
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('история батча не записана'),
      expect.objectContaining({ message: 'history db down' })
    );
  });

  it('пустой список строк не зовёт createMany (нечего писать)', async () => {
    const prisma = historyPrisma();
    const result = await commitImport(prisma, adminSession, { fileBuffer });
    expect(result).toMatchObject({ ok: true });
    expect(
      (prisma as { oneCImportRow: { createMany: ReturnType<typeof vi.fn> } }).oneCImportRow
        .createMany
    ).not.toHaveBeenCalled();
  });
});
