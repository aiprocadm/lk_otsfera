/**
 * «Выгрузить в 1С» / «Повторить» (`У-169`) и массовая выгрузка из списка —
 * тонкие адаптеры над сервисом. Проверяется ровно то, за что отвечает
 * адаптер: пустая форма не доходит до сервиса, а после постановки
 * обновляются экраны всех трёх кабинетов сотрудников.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSession, revalidatePath, requestDocumentPush, requestDocumentPushMany } =
  vi.hoisted(() => ({
    requireSession: vi.fn(),
    revalidatePath: vi.fn(),
    requestDocumentPush: vi.fn(),
    requestDocumentPushMany: vi.fn(),
  }));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/services/documents/pushToOneC', () => ({
  requestDocumentPush,
  requestDocumentPushMany,
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { prisma } from '@/lib/db/prisma';
import {
  requestDocumentPushAction,
  requestDocumentPushManyAction,
} from '@/server-actions/documents/pushToOneC';

const SESSION = { sub: 'm1', role: 'manager', companyId: 'co-A' };

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
});

describe('requestDocumentPushAction', () => {
  it('успех: сервис вызван, обновлены карточка и список у менеджера, руководителя и админа', async () => {
    requestDocumentPush.mockResolvedValue({ ok: true, retry: false });
    const fd = new FormData();
    fd.set('documentId', 'doc-1');

    const res = await requestDocumentPushAction(fd);

    expect(res).toEqual({ ok: true, retry: false });
    expect(requestDocumentPush).toHaveBeenCalledWith(prisma, SESSION, 'doc-1');
    for (const cabinet of ['manager', 'leader', 'admin']) {
      expect(revalidatePath).toHaveBeenCalledWith(`/${cabinet}/documents/doc-1`);
      expect(revalidatePath).toHaveBeenCalledWith(`/${cabinet}/documents`);
    }
  });

  it('пустая форма → not_found, сервис не вызывается', async () => {
    const res = await requestDocumentPushAction(new FormData());
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(requestDocumentPush).not.toHaveBeenCalled();
  });

  it('отказ сервиса возвращается как есть, экраны не обновляются', async () => {
    requestDocumentPush.mockResolvedValue({ ok: false, error: 'push_disabled' });
    const fd = new FormData();
    fd.set('documentId', 'doc-1');
    expect(await requestDocumentPushAction(fd)).toEqual({ ok: false, error: 'push_disabled' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('requestDocumentPushManyAction', () => {
  it('собирает documentIds из формы и обновляет экраны только поставленных документов', async () => {
    requestDocumentPushMany.mockResolvedValue({
      ok: true,
      queued: 1,
      skipped: [{ documentId: 'doc-2', error: 'not_pushable_type' }],
    });
    const fd = new FormData();
    fd.append('documentIds', 'doc-1');
    fd.append('documentIds', 'doc-2');
    fd.append('documentIds', '');

    const res = await requestDocumentPushManyAction(fd);

    expect(res).toEqual({
      ok: true,
      queued: 1,
      skipped: [{ documentId: 'doc-2', error: 'not_pushable_type' }],
    });
    expect(requestDocumentPushMany).toHaveBeenCalledWith(prisma, SESSION, ['doc-1', 'doc-2']);
    expect(revalidatePath).toHaveBeenCalledWith('/manager/documents/doc-1');
    expect(revalidatePath).not.toHaveBeenCalledWith('/manager/documents/doc-2');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/documents');
  });

  it('ничего не поставлено — экраны не трогаются', async () => {
    requestDocumentPushMany.mockResolvedValue({
      ok: true,
      queued: 0,
      skipped: [{ documentId: 'doc-1', error: 'already_queued' }],
    });
    const fd = new FormData();
    fd.append('documentIds', 'doc-1');
    await requestDocumentPushManyAction(fd);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('forbidden от сервиса возвращается как есть', async () => {
    requestDocumentPushMany.mockResolvedValue({ ok: false, error: 'forbidden' });
    const fd = new FormData();
    fd.append('documentIds', 'doc-1');
    expect(await requestDocumentPushManyAction(fd)).toEqual({ ok: false, error: 'forbidden' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
