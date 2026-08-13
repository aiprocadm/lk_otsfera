import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
const {
  previewPaymentImport,
  commitPaymentImport,
  searchResolveOrgs,
  listResolveOrders,
  createOrgFromQueueRow,
  resolveQueueRow,
  dismissQueueRow,
  planQueueOrgCreation,
  createOrgsFromQueueRows,
} = vi.hoisted(() => ({
  previewPaymentImport: vi.fn(),
  commitPaymentImport: vi.fn(),
  searchResolveOrgs: vi.fn(),
  listResolveOrders: vi.fn(),
  createOrgFromQueueRow: vi.fn(),
  resolveQueueRow: vi.fn(),
  dismissQueueRow: vi.fn(),
  planQueueOrgCreation: vi.fn(),
  createOrgsFromQueueRows: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/import/oneCAccountCard', () => ({
  previewPaymentImport,
  commitPaymentImport,
  resolveQueueRow,
  dismissQueueRow,
  searchResolveOrgs,
  listResolveOrders,
  createOrgFromQueueRow,
  planQueueOrgCreation,
  createOrgsFromQueueRows,
}));
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath }));

import {
  previewPaymentImportAction,
  commitPaymentImportAction,
  searchResolveOrgsAction,
  listResolveOrdersAction,
  createOrgFromQueueRowAction,
  resolveQueueRowAction,
  dismissQueueRowAction,
  planQueueOrgCreationAction,
  createOrgsFromQueueRowsAction,
} from '@/server-actions/payment-import';

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ sub: 'u1', role: 'admin' });
});

function form(file?: File): FormData {
  const f = new FormData();
  if (file) f.set('file', file);
  return f;
}

describe('previewPaymentImportAction', () => {
  it('rejects non-file', async () => {
    expect(await previewPaymentImportAction(form())).toEqual({ ok: false, error: 'invalid_file' });
  });
  it('rejects wrong extension', async () => {
    const file = new File(['x'], 'c.pdf', { type: 'application/pdf' });
    expect(await previewPaymentImportAction(form(file))).toEqual({
      ok: false,
      error: 'invalid_file',
    });
  });
  it('accepts .xls and delegates', async () => {
    previewPaymentImport.mockResolvedValue({ ok: true, plan: { counts: {} } });
    const file = new File(['x'], 'card.xls');
    const res = await previewPaymentImportAction(form(file));
    expect(res.ok).toBe(true);
    expect(previewPaymentImport).toHaveBeenCalledOnce();
  });
  it('accepts .xlsx and delegates', async () => {
    previewPaymentImport.mockResolvedValue({ ok: true, plan: { counts: {} } });
    const file = new File(['x'], 'card.xlsx');
    expect((await previewPaymentImportAction(form(file))).ok).toBe(true);
  });
});

describe('searchResolveOrgsAction', () => {
  it('delegates to the scoped org search with the session', async () => {
    searchResolveOrgs.mockResolvedValue([{ id: 'o1', name: 'A', inn: null }]);
    const res = await searchResolveOrgsAction({ q: 'A' });
    expect(res).toEqual([{ id: 'o1', name: 'A', inn: null }]);
    expect(searchResolveOrgs).toHaveBeenCalledWith({}, { sub: 'u1', role: 'admin' }, { q: 'A' });
  });
});

describe('listResolveOrdersAction', () => {
  it('delegates to the scoped order list with the session', async () => {
    listResolveOrders.mockResolvedValue([{ id: 'ord1', orderNumber: '7', title: 'X' }]);
    const res = await listResolveOrdersAction({ organizationId: 'o1' });
    expect(res).toEqual([{ id: 'ord1', orderNumber: '7', title: 'X' }]);
    expect(listResolveOrders).toHaveBeenCalledWith(
      {},
      { sub: 'u1', role: 'admin' },
      { organizationId: 'o1' }
    );
  });
});

/** Этап 10 (Т-30): экшен создания организации из очереди — тонкий адаптер. */
describe('createOrgFromQueueRowAction', () => {
  it('успех → ревалидация обеих payments-страниц', async () => {
    createOrgFromQueueRow.mockResolvedValue({ ok: true, organizationId: 'o1', paymentId: 'p1' });
    const args = { rowId: 'r1', name: 'ООО', inn: '7707083893', companyId: 'co-1' };
    const res = await createOrgFromQueueRowAction(args);
    expect(createOrgFromQueueRow).toHaveBeenCalledWith({}, { sub: 'u1', role: 'admin' }, args);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings/integrations/1c/payments');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/settings/integrations/1c/payments');
    expect(res).toMatchObject({ ok: true });
  });

  it('отказ → без ревалидации, результат пробрасывается', async () => {
    createOrgFromQueueRow.mockResolvedValue({ ok: false, error: 'org_exists' });
    const res = await createOrgFromQueueRowAction({ rowId: 'r1', name: 'x', inn: 'y' });
    expect(res).toEqual({ ok: false, error: 'org_exists' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

/**
 * Экшены, которых не касался ни один тест — половина файла не исполнялась
 * (долг гейта покрытия). Все они тонкие адаптеры: важно, что сессия доходит до
 * сервиса, что кривой файл не пропускается и что экраны обновляются только
 * после успешной записи.
 */
describe('commitPaymentImportAction', () => {
  it('кривой файл до сервиса не доходит', async () => {
    expect(await commitPaymentImportAction(form())).toEqual({ ok: false, error: 'invalid_file' });
    expect(commitPaymentImport).not.toHaveBeenCalled();
  });

  it('слишком большой файл отвергается по размеру, а не по имени', async () => {
    // Предел общий с импортом Excel и next.config: иначе человек получил бы
    // невнятную ошибку платформы вместо понятного отказа.
    const huge = new File([new Uint8Array(1)], 'p.xlsx');
    Object.defineProperty(huge, 'size', { value: 500 * 1024 * 1024 });
    expect(await commitPaymentImportAction(form(huge))).toEqual({
      ok: false,
      error: 'invalid_file',
    });
    expect(commitPaymentImport).not.toHaveBeenCalled();
  });

  it('файл и его имя доходят до сервиса', async () => {
    commitPaymentImport.mockResolvedValue({ ok: true, created: 2 });
    const res = await commitPaymentImportAction(
      form(new File([new Uint8Array([1])], 'Выписка.xlsx'))
    );

    expect(res).toEqual({ ok: true, created: 2 });
    const args = commitPaymentImport.mock.calls[0][2];
    expect(args.fileName).toBe('Выписка.xlsx');
    expect(Buffer.isBuffer(args.fileBuffer)).toBe(true);
  });

  it('выбранная компания передаётся сервису, пустая — нет (У-50)', async () => {
    commitPaymentImport.mockResolvedValue({ ok: true });

    const withCompany = form(new File([new Uint8Array([1])], 'p.xlsx'));
    withCompany.set('companyId', '  co-7  ');
    await commitPaymentImportAction(withCompany);
    expect(commitPaymentImport.mock.calls[0][2].companyId).toBe('co-7');

    const blank = form(new File([new Uint8Array([1])], 'p.xlsx'));
    blank.set('companyId', '   ');
    await commitPaymentImportAction(blank);
    // Пусто — пусть сервис решает сам, а не получает пустую строку.
    expect(commitPaymentImport.mock.calls[1][2]).not.toHaveProperty('companyId');
  });
});

describe('разбор очереди платежей', () => {
  it('resolveQueueRowAction передаёт сессию и аргументы как есть', async () => {
    resolveQueueRow.mockResolvedValue({ ok: true });
    const args = { rowId: 'r1', organizationId: 'o1', orderId: null };
    await expect(resolveQueueRowAction(args)).resolves.toEqual({ ok: true });
    expect(resolveQueueRow).toHaveBeenCalledWith({}, { sub: 'u1', role: 'admin' }, args);
  });

  it('dismissQueueRowAction — тоже только адаптер', async () => {
    dismissQueueRow.mockResolvedValue({ ok: true });
    await expect(dismissQueueRowAction({ rowId: 'r1' })).resolves.toEqual({ ok: true });
    expect(dismissQueueRow).toHaveBeenCalledWith({}, { sub: 'u1', role: 'admin' }, { rowId: 'r1' });
  });
});

describe('пакетное создание организаций из очереди (У-53)', () => {
  it('шаг 1 только показывает список и ничего не пишет', async () => {
    planQueueOrgCreation.mockResolvedValue({ ok: true, rows: [] });
    await expect(planQueueOrgCreationAction()).resolves.toEqual({ ok: true, rows: [] });
    expect(createOrgsFromQueueRows).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('шаг 2 после успеха обновляет все три экрана очереди', async () => {
    createOrgsFromQueueRows.mockResolvedValue({ ok: true, created: 3 });
    const res = await createOrgsFromQueueRowsAction({ rowIds: ['r1', 'r2'] });

    expect(res).toEqual({ ok: true, created: 3 });
    expect(revalidatePath.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      '/admin/settings/integrations/1c/payments',
      '/leader/settings/integrations/1c/payments',
      '/manager/payments-import',
    ]);
  });

  it('после отказа экраны не трогаем', async () => {
    createOrgsFromQueueRows.mockResolvedValue({ ok: false, error: 'company_required' });
    const res = await createOrgsFromQueueRowsAction({ rowIds: ['r1'] });

    expect(res).toEqual({ ok: false, error: 'company_required' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
