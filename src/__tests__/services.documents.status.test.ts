import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAuditMock } = vi.hoisted(() => ({ recordAuditMock: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));

import { setDocumentStatus } from '@/lib/services/documents/status';

/**
 * `У-148` — единственная дверь к полю `status`. Проверяем, что она заперта:
 * переход вне матрицы отбивается кодом, а не пишется в базу.
 */
const session = { sub: 'u1', role: 'manager' } as unknown as SessionPayload;

function fake(doc: { type?: string; status?: string } | null = {}) {
  const findUnique = vi.fn(async () =>
    doc === null ? null : { id: 'd1', type: doc.type ?? 'invoice', status: doc.status ?? 'issued' }
  );
  // Аргументы типизируем явно: без этого `mock.calls[0]` — пустой кортеж.
  const update = vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => ({
    id: String((args.where as { id?: string }).id ?? 'd1'),
  }));
  return {
    prisma: { document: { findUnique, update } } as unknown as PrismaClient,
    findUnique,
    update,
  };
}

beforeEach(() => recordAuditMock.mockReset());

describe('setDocumentStatus', () => {
  it('нет документа — not_found, база не трогается', async () => {
    const f = fake(null);
    expect(await setDocumentStatus(f.prisma, session, { documentId: 'x', to: 'sent' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(f.update).not.toHaveBeenCalled();
  });

  it('у файла без жизненного цикла статуса нет — not_lifecycle_type', async () => {
    const f = fake({ type: 'other' });
    expect(await setDocumentStatus(f.prisma, session, { documentId: 'd1', to: 'sent' })).toEqual({
      ok: false,
      error: 'not_lifecycle_type',
    });
    expect(f.update).not.toHaveBeenCalled();
  });

  it('переход вне матрицы отбивается и НЕ пишется в базу', async () => {
    const f = fake({ status: 'accepted' });
    const res = await setDocumentStatus(f.prisma, session, { documentId: 'd1', to: 'sent' });
    expect(res).toEqual({ ok: false, error: 'invalid_transition', from: 'accepted', to: 'sent' });
    expect(f.update).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it('отправка проставляет «кто и когда» и пишет аудит по-русски', async () => {
    const f = fake({ status: 'issued' });
    expect(await setDocumentStatus(f.prisma, session, { documentId: 'd1', to: 'sent' })).toEqual({
      ok: true,
    });
    const data = f.update.mock.calls[0]![0].data;
    expect(data.status).toBe('sent');
    expect(data.sentById).toBe('u1');
    expect(data.sentAt).toBeInstanceOf(Date);
    const audit = recordAuditMock.mock.calls[0]![1];
    expect(audit.action).toBe('document_status_changed');
    expect(audit.before.status).toBe('Выставлен');
    expect(audit.after.status).toBe('Отправлен');
  });

  it('принятие помечает, кто принял (заказчик или сотрудник — решает вызывающий)', async () => {
    const f = fake({ status: 'sent', type: 'act' });
    await setDocumentStatus(f.prisma, session, { documentId: 'd1', to: 'accepted' });
    const data = f.update.mock.calls[0]![0].data;
    expect(data.acceptedByUserId).toBe('u1');
    expect(data.acceptedAt).toBeInstanceOf(Date);
  });

  it('аннулирование хранит причину; пустая причина — null, а не пробелы', async () => {
    const f = fake({ status: 'issued' });
    await setDocumentStatus(f.prisma, session, {
      documentId: 'd1',
      to: 'cancelled',
      reason: '  выставлен по ошибке  ',
    });
    expect(f.update.mock.calls[0]![0].data.cancelReason).toBe('выставлен по ошибке');

    const g = fake({ status: 'issued' });
    await setDocumentStatus(g.prisma, session, {
      documentId: 'd1',
      to: 'cancelled',
      reason: '   ',
    });
    expect(g.update.mock.calls[0]![0].data.cancelReason).toBeNull();
    expect(recordAuditMock.mock.calls.at(-1)![1].after.reason).toBeNull();
  });

  /**
   * `У-165` (этап 7) — отказ КЛИЕНТА пишется в СВОИ поля.
   *
   * «Аннулировал сотрудник» и «клиент сказал нет» — разные события: первое
   * означает нашу ошибку в бумаге, второе — ответ по существу. Свалив их в
   * одно поле, мы потеряли бы возможность отличить одно от другого в
   * отчётности о причинах отказов.
   */
  it('отказ клиента ложится в `rejectedAt`/`rejectReason`, а не в поля аннулирования', async () => {
    const f = fake({ type: 'commercial_proposal', status: 'sent' });
    await setDocumentStatus(f.prisma, session, {
      documentId: 'd1',
      to: 'rejected',
      reason: '  дорого  ',
    });
    const data = f.update.mock.calls[0]![0].data;
    expect(data.rejectReason).toBe('дорого');
    expect(data.rejectedAt).toBeInstanceOf(Date);
    expect(data.cancelReason).toBeUndefined();
    expect(data.cancelledAt).toBeUndefined();
  });
});
