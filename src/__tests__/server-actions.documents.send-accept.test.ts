/**
 * Действия карточки документа: «Отправить заказчику» (`У-149`) и «Принять»
 * (`У-150`).
 *
 * Оба действия — тонкие адаптеры: права, письмо и статусы живут в сервисах.
 * Здесь проверяется ровно то, за что отвечает адаптер: пустая форма не
 * доходит до сервиса, а успешное действие обновляет нужные экраны — и обе
 * карточки сотрудника, а не только ту, откуда нажали.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSession, revalidatePath, sendDocumentToCustomer, acceptDocument } = vi.hoisted(
  () => ({
    requireSession: vi.fn(),
    revalidatePath: vi.fn(),
    sendDocumentToCustomer: vi.fn(),
    acceptDocument: vi.fn(),
  })
);

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/services/documents/send', () => ({ sendDocumentToCustomer }));
vi.mock('@/lib/services/documents/accept', () => ({ acceptDocument }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { prisma } from '@/lib/db/prisma';
import { sendDocumentAction } from '@/server-actions/documents/send';
import { acceptDocumentAction } from '@/server-actions/documents/accept';

const SESSION = { sub: 'm1', role: 'manager', companyId: 'co-A' };

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
});

describe('sendDocumentAction', () => {
  it('успех: сервис вызван, обновлены карточки менеджера и руководителя', async () => {
    sendDocumentToCustomer.mockResolvedValue({
      ok: true,
      recipients: 2,
      attached: true,
      repeat: false,
    });

    const res = await sendDocumentAction(form({ documentId: 'doc-1' }));

    expect(res).toEqual({ ok: true, recipients: 2, attached: true, repeat: false });
    expect(sendDocumentToCustomer).toHaveBeenCalledWith(prisma, SESSION, 'doc-1');
    expect(revalidatePath).toHaveBeenCalledWith('/manager/documents/doc-1');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/documents/doc-1');
  });

  it('пустая форма не доходит до сервиса', async () => {
    expect(await sendDocumentAction(form({}))).toEqual({ ok: false, error: 'not_found' });
    expect(sendDocumentToCustomer).not.toHaveBeenCalled();
  });

  it('отказ сервиса возвращается как есть и экраны не обновляются', async () => {
    sendDocumentToCustomer.mockResolvedValue({ ok: false, error: 'no_recipients' });

    expect(await sendDocumentAction(form({ documentId: 'doc-1' }))).toEqual({
      ok: false,
      error: 'no_recipients',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('acceptDocumentAction', () => {
  it('успех: сервис вызван, карточка заказчика обновлена', async () => {
    acceptDocument.mockResolvedValue({ ok: true });

    expect(await acceptDocumentAction(form({ documentId: 'doc-1' }))).toEqual({ ok: true });
    expect(acceptDocument).toHaveBeenCalledWith(prisma, SESSION, 'doc-1');
    expect(revalidatePath).toHaveBeenCalledWith('/organization/documents/doc-1');
  });

  it('пустая форма не доходит до сервиса', async () => {
    expect(await acceptDocumentAction(form({}))).toEqual({ ok: false, error: 'not_found' });
    expect(acceptDocument).not.toHaveBeenCalled();
  });

  it('отказ сервиса не обновляет экран', async () => {
    acceptDocument.mockResolvedValue({ ok: false, error: 'not_acceptable' });

    expect(await acceptDocumentAction(form({ documentId: 'doc-1' }))).toEqual({
      ok: false,
      error: 'not_acceptable',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
