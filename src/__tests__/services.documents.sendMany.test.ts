/**
 * `У-258` — массовая отправка документов заказчику.
 *
 * Главное правило: **одно письмо на организацию** (`В-8-6`). Три бумаги одному
 * клиенту — одно письмо с тремя вложениями, а не три письма подряд; три письма
 * за минуту человек читает как сбой рассылки.
 *
 * Второе правило: отбор идёт ДО отправки, и всё, что не ушло, возвращается с
 * причиной. Молча отправить часть — худший из вариантов: сотрудник будет
 * уверен, что клиент получил всё.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { canReadDocument, sendDocumentToCustomer } = vi.hoisted(() => ({
  canReadDocument: vi.fn(),
  sendDocumentToCustomer: vi.fn(),
}));
vi.mock('@/lib/auth/policy', () => ({ canReadDocument }));
vi.mock('@/lib/services/documents/send', () => ({ sendDocumentToCustomer }));

import { sendDocumentsToClients, SEND_MANY_LIMIT } from '@/lib/services/documents/sendMany';

const staff = { sub: 'm1', role: 'manager', companyId: 'co1' } as SessionPayload;
const client = { sub: 'o1', role: 'organization' } as SessionPayload;

function doc(over: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    type: 'invoice',
    status: 'issued',
    scanStatus: 'clean',
    counterpartyType: 'organization',
    counterpartyId: 'org-1',
    companyId: 'co1',
    orderId: 'ord1',
    number: 'С-1',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    supersededAt: null,
    order: { companyId: 'co1' },
    ...over,
  };
}

function db(rows: unknown[]) {
  return {
    document: { findMany: vi.fn().mockResolvedValue(rows) },
  } as unknown as PrismaClient;
}

describe('sendDocumentsToClients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canReadDocument.mockResolvedValue(true);
    sendDocumentToCustomer.mockResolvedValue({
      ok: true,
      recipients: 2,
      attached: true,
      repeat: false,
    });
  });

  it('клиентские роли к массовой отправке не допускаются', async () => {
    const prisma = db([]);
    expect(await sendDocumentsToClients(prisma, client, ['d1'])).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(prisma.document.findMany).not.toHaveBeenCalled();
  });

  it('пустой выбор — отдельный ответ, а не «отправлено 0»', async () => {
    expect(await sendDocumentsToClients(db([]), staff, [])).toEqual({
      ok: false,
      error: 'no_documents',
    });
  });

  it('три бумаги одной организации — ОДНО письмо', async () => {
    const rows = [doc(), doc({ id: 'd2', type: 'act' }), doc({ id: 'd3', type: 'contract' })];
    const res = await sendDocumentsToClients(db(rows), staff, ['d1', 'd2', 'd3']);

    expect(res).toMatchObject({ ok: true, organizations: 1, sent: 3 });
    expect(sendDocumentToCustomer).toHaveBeenCalledTimes(1);
    expect(sendDocumentToCustomer.mock.calls[0]![2]).toBe('d1');
    expect(sendDocumentToCustomer.mock.calls[0]![3]).toEqual({ alsoDocumentIds: ['d2', 'd3'] });
  });

  it('две организации — два письма, по одному каждой', async () => {
    const rows = [doc(), doc({ id: 'd2', counterpartyId: 'org-2' })];
    const res = await sendDocumentsToClients(db(rows), staff, ['d1', 'd2']);
    expect(res).toMatchObject({ ok: true, organizations: 2, sent: 2 });
    expect(sendDocumentToCustomer).toHaveBeenCalledTimes(2);
  });

  it('чужой документ и несуществующий возвращаются с причиной, а не молча', async () => {
    canReadDocument.mockImplementation(async (_s: unknown, d: { id: string }) => d.id !== 'd2');
    const rows = [doc(), doc({ id: 'd2' })];
    const res = await sendDocumentsToClients(db(rows), staff, ['d1', 'd2', 'd-нет']);
    expect(res.ok && res.sent).toBe(1);
    expect(res.ok && res.skipped).toEqual(
      expect.arrayContaining([
        { documentId: 'd2', reason: 'not_found' },
        { documentId: 'd-нет', reason: 'not_found' },
      ])
    );
  });

  it('заменённая версия клиенту не уходит — у неё уже есть преемник', async () => {
    // Причина отдельная: «не найден» человек прочитал бы как «документ пропал»,
    // хотя документ на месте и просто устарел.
    const res = await sendDocumentsToClients(
      db([doc({ supersededAt: new Date('2026-09-10T00:00:00Z') })]),
      staff,
      ['d1']
    );
    expect(res.ok && res.skipped).toEqual([{ documentId: 'd1', reason: 'superseded' }]);
    expect(sendDocumentToCustomer).not.toHaveBeenCalled();
  });

  it('заражённый файл не уходит клиенту', async () => {
    const res = await sendDocumentsToClients(db([doc({ scanStatus: 'infected' })]), staff, ['d1']);
    expect(res.ok && res.skipped).toEqual([{ documentId: 'd1', reason: 'infected' }]);
    expect(sendDocumentToCustomer).not.toHaveBeenCalled();
  });

  it('бумага без адресата и не того типа отсеивается до письма', async () => {
    const rows = [
      doc({ id: 'd1', type: 'report' }),
      doc({ id: 'd2', counterpartyType: 'partner', counterpartyId: 'p1' }),
      doc({ id: 'd3', status: 'cancelled' }),
    ];
    const res = await sendDocumentsToClients(db(rows), staff, ['d1', 'd2', 'd3']);
    expect(res.ok && res.sent).toBe(0);
    expect(res.ok && res.skipped.map((s) => s.reason)).toEqual([
      'not_sendable',
      'not_sendable',
      'not_sendable',
    ]);
  });

  it('отказ письма помечает ВСЮ пачку организации, а не только первую бумагу', async () => {
    sendDocumentToCustomer.mockResolvedValue({ ok: false, error: 'no_recipients' });
    const rows = [doc(), doc({ id: 'd2', type: 'act' })];
    const res = await sendDocumentsToClients(db(rows), staff, ['d1', 'd2']);
    expect(res.ok && res.sent).toBe(0);
    expect(res.ok && res.skipped).toEqual([
      { documentId: 'd1', reason: 'no_recipients' },
      { documentId: 'd2', reason: 'no_recipients' },
    ]);
  });

  it('повторы в выборе схлопываются, предел применяется', async () => {
    const ids = Array.from({ length: SEND_MANY_LIMIT + 10 }, (_, i) => `d${i}`);
    const prisma = db([]);
    await sendDocumentsToClients(prisma, staff, [...ids, ...ids]);
    const asked = (prisma.document.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0].where.id
      .in as string[];
    expect(asked).toHaveLength(SEND_MANY_LIMIT);
  });
});
