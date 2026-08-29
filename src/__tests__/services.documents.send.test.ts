import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const {
  canReadDocument,
  setDocumentStatus,
  sendOrgDocumentSentEmail,
  getTemplateOverride,
  applyOverride,
  recordAudit,
  download,
  warn,
} = vi.hoisted(() => ({
  canReadDocument: vi.fn(),
  setDocumentStatus: vi.fn(),
  sendOrgDocumentSentEmail: vi.fn(),
  getTemplateOverride: vi.fn(),
  applyOverride: vi.fn(),
  recordAudit: vi.fn(),
  download: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/lib/auth/policy', () => ({ canReadDocument }));
vi.mock('@/lib/services/documents/status', () => ({ setDocumentStatus }));
vi.mock('@/lib/email/send', () => ({ sendOrgDocumentSentEmail }));
vi.mock('@/lib/email/templateOverrides', () => ({ getTemplateOverride, applyOverride }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ download }) }));
vi.mock('@/lib/logging', () => ({ log: { warn, error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/notifications/shared', () => ({ getAppBaseUrl: () => 'https://lk.example' }));

import { sendDocumentToCustomer } from '@/lib/services/documents/send';

/**
 * `У-149` — сотрудник отправляет документ заказчику письмом.
 *
 * Главное в этом действии — что оно **не врёт**. Письмо ушло — документ
 * помечен отправленным; письмо не ушло (некому, файл заражён, почта
 * выключена) — отметки нет. Отметка «отправлен» без письма хуже, чем ошибка
 * на экране: менеджер решит, что клиент документ видел.
 */

const staff = (role = 'manager'): SessionPayload =>
  ({ sub: 'u-staff', role, companyId: 'co-1' }) as unknown as SessionPayload;

const DOC = {
  id: 'doc-1',
  name: 'invoice-v1-abc.pdf',
  path: 'orders/ord-1/generated/invoice-v1-abc.pdf',
  type: 'invoice',
  number: 'С-2026-17',
  version: 1,
  createdAt: new Date('2026-08-28T10:00:00Z'),
  status: 'issued',
  scanStatus: 'clean',
  companyId: 'co-1',
  counterpartyType: 'organization',
  counterpartyId: 'org-1',
  orderId: 'ord-1',
  order: { id: 'ord-1', orderNumber: '123', title: 'Обучение', companyId: 'co-1' },
};

const ORG = {
  id: 'org-1',
  name: 'ООО «Ромашка»',
  companyId: 'co-1',
  organizationUsers: [
    { user: { id: 'u-1', email: 'client@example.ru', name: 'Иван' } },
    { user: { id: 'u-2', email: 'buh@example.ru', name: 'Мария' } },
  ],
};

function fake(doc: Record<string, unknown> | null = {}, org: unknown = ORG) {
  const documentFindUnique = vi.fn(async () => (doc === null ? null : { ...DOC, ...doc }));
  const documentUpdate = vi.fn(async () => ({}));
  const organizationFindUnique = vi.fn(async () => org);
  const prisma = {
    document: { findUnique: documentFindUnique, update: documentUpdate },
    organization: { findUnique: organizationFindUnique },
  } as unknown as PrismaClient;
  return { prisma, documentFindUnique, documentUpdate, organizationFindUnique };
}

beforeEach(() => {
  vi.clearAllMocks();
  canReadDocument.mockResolvedValue(true);
  setDocumentStatus.mockResolvedValue({ ok: true });
  sendOrgDocumentSentEmail.mockResolvedValue({ status: 'sent', id: 'mail-1' });
  getTemplateOverride.mockResolvedValue(null);
  download.mockResolvedValue(Buffer.from('%PDF-1.4'));
});

describe('отправка документа заказчику письмом', () => {
  it('счёт уходит обоим сотрудникам организации: PDF вложением и ссылка в кабинет', async () => {
    const f = fake();
    const res = await sendDocumentToCustomer(f.prisma, staff(), 'doc-1');

    expect(res).toEqual({ ok: true, recipients: 2, attached: true, repeat: false });
    expect(sendOrgDocumentSentEmail).toHaveBeenCalledTimes(2);
    const args = sendOrgDocumentSentEmail.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.to).toBe('client@example.ru');
    expect(args.documentUrl).toBe('https://lk.example/organization/documents/doc-1');
    expect(args.documentNumber).toBe('С-2026-17');
    // Имя вложения человеческое, а не ключ в хранилище (`У-154`).
    expect(args.attachments).toEqual([
      { filename: 'Счёт С-2026-17 от 28.08.2026.pdf', content: expect.any(Buffer) },
    ]);
  });

  it('после отправки документ помечается отправленным через общую дверь статусов', async () => {
    const f = fake();
    await sendDocumentToCustomer(f.prisma, staff(), 'doc-1');
    expect(setDocumentStatus).toHaveBeenCalledWith(f.prisma, expect.anything(), {
      documentId: 'doc-1',
      to: 'sent',
    });
  });

  it('повторная отправка — новое событие аудита, отметка времени обновляется', async () => {
    // Матрица не пускает `sent → sent`, но повторно отправить документ можно:
    // клиент потерял письмо. Статус остаётся прежним, отметка — новая.
    const f = fake({ status: 'sent' });
    const res = await sendDocumentToCustomer(f.prisma, staff(), 'doc-1');

    expect(res).toEqual({ ok: true, recipients: 2, attached: true, repeat: true });
    expect(setDocumentStatus).not.toHaveBeenCalled();
    expect(f.documentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'doc-1' } })
    );
    expect(recordAudit).toHaveBeenCalledWith(
      f.prisma,
      expect.objectContaining({ action: 'document_sent', entityId: 'doc-1' })
    );
  });

  it('каждая отправка пишет своё событие аудита', async () => {
    const f = fake();
    await sendDocumentToCustomer(f.prisma, staff(), 'doc-1');
    expect(recordAudit).toHaveBeenCalledWith(
      f.prisma,
      expect.objectContaining({ action: 'document_sent' })
    );
  });

  it('свой текст письма (`У-128`) применяется, если он задан', async () => {
    getTemplateOverride.mockResolvedValue({ subject: 'Тема', body: 'Текст {{document.number}}' });
    applyOverride.mockReturnValue({ subject: 'Тема', text: 'Текст С-2026-17' });
    const f = fake();
    await sendDocumentToCustomer(f.prisma, staff(), 'doc-1');

    expect(getTemplateOverride).toHaveBeenCalledWith(f.prisma, 'orgDocumentSent', 'co-1');
    const args = sendOrgDocumentSentEmail.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.override).toEqual({
      subject: 'Тема',
      text: 'Текст С-2026-17',
      recipientName: 'Иван',
    });
  });

  it('файл не читается — письмо всё равно уходит, но без вложения', async () => {
    download.mockRejectedValue(new Error('S3 недоступен'));
    const f = fake();
    const res = await sendDocumentToCustomer(f.prisma, staff(), 'doc-1');

    expect(res).toEqual({ ok: true, recipients: 2, attached: false, repeat: false });
    const args = sendOrgDocumentSentEmail.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.attachments).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('заражённый файл не рассылается', async () => {
    const f = fake({ scanStatus: 'infected' });
    expect(await sendDocumentToCustomer(f.prisma, staff(), 'doc-1')).toEqual({
      ok: false,
      error: 'infected',
    });
    expect(sendOrgDocumentSentEmail).not.toHaveBeenCalled();
  });

  it('заказчик сам себе документ не отправляет', async () => {
    const f = fake();
    const client = { sub: 'u-1', role: 'organization' } as unknown as SessionPayload;
    expect(await sendDocumentToCustomer(f.prisma, client, 'doc-1')).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('чужой документ не находится', async () => {
    canReadDocument.mockResolvedValue(false);
    const f = fake();
    expect(await sendDocumentToCustomer(f.prisma, staff(), 'doc-1')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('документа нет — not_found', async () => {
    const f = fake(null);
    expect(await sendDocumentToCustomer(f.prisma, staff(), 'doc-1')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('файл без жизненного цикла (скан, отчёт) этой кнопкой не отправляется', async () => {
    const f = fake({ type: 'other' });
    expect(await sendDocumentToCustomer(f.prisma, staff(), 'doc-1')).toEqual({
      ok: false,
      error: 'not_sendable',
    });
  });

  it('документ партнёра этой кнопкой не отправляется', async () => {
    const f = fake({ counterpartyType: 'partner' });
    expect(await sendDocumentToCustomer(f.prisma, staff(), 'doc-1')).toEqual({
      ok: false,
      error: 'not_sendable',
    });
  });

  it('аннулированный документ не отправляется', async () => {
    const f = fake({ status: 'cancelled' });
    expect(await sendDocumentToCustomer(f.prisma, staff(), 'doc-1')).toEqual({
      ok: false,
      error: 'not_sendable',
    });
  });

  it('у организации нет ни одного адреса — отметки «отправлен» не появляется', async () => {
    const f = fake({}, { ...ORG, organizationUsers: [] });
    expect(await sendDocumentToCustomer(f.prisma, staff(), 'doc-1')).toEqual({
      ok: false,
      error: 'no_recipients',
    });
    expect(setDocumentStatus).not.toHaveBeenCalled();
  });

  it('почта выключена — документ не считается отправленным', async () => {
    // `send()` возвращает `skipped`, когда почта выключена в настройках.
    // Пометить документ отправленным в этом случае — соврать менеджеру.
    sendOrgDocumentSentEmail.mockResolvedValue({ status: 'skipped', reason: 'disabled' });
    const f = fake();
    expect(await sendDocumentToCustomer(f.prisma, staff(), 'doc-1')).toEqual({
      ok: false,
      error: 'email_disabled',
    });
    expect(setDocumentStatus).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('организация исчезла — not_found, а не пустая рассылка', async () => {
    const f = fake({}, null);
    expect(await sendDocumentToCustomer(f.prisma, staff(), 'doc-1')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('документ вне заказа отправляется: в письме просто нет заказа', async () => {
    const f = fake({ orderId: null, order: null, companyId: 'co-1' });
    const res = await sendDocumentToCustomer(f.prisma, staff(), 'doc-1');

    expect(res.ok).toBe(true);
    const args = sendOrgDocumentSentEmail.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.orderNumber).toBeNull();
    expect(args.orderTitle).toBeNull();
  });

  it('компания берётся у заказа, если у документа её нет', async () => {
    // Свой текст письма пишет компания-ПРОДАВЕЦ. У документа поле может быть
    // пустым (загружен до этапа 6) — тогда её знает заказ.
    const f = fake({ companyId: null });
    await sendDocumentToCustomer(f.prisma, staff(), 'doc-1');
    expect(getTemplateOverride).toHaveBeenCalledWith(f.prisma, 'orgDocumentSent', 'co-1');
  });

  it('компании нет нигде — письмо уходит по общему тексту платформы', async () => {
    const f = fake({ companyId: null, order: { ...DOC.order, companyId: null } });
    await sendDocumentToCustomer(f.prisma, staff(), 'doc-1');
    expect(getTemplateOverride).toHaveBeenCalledWith(f.prisma, 'orgDocumentSent', null);
  });

  it('получателю без имени пишем нейтрально, а не пустотой', async () => {
    getTemplateOverride.mockResolvedValue({ subject: 'Тема', body: 'Текст' });
    applyOverride.mockReturnValue({ subject: 'Тема', text: 'Текст' });
    const f = fake(
      {},
      {
        ...ORG,
        organizationUsers: [{ user: { id: 'u-1', email: 'client@example.ru', name: null } }],
      }
    );

    await sendDocumentToCustomer(f.prisma, staff(), 'doc-1');
    const args = sendOrgDocumentSentEmail.mock.calls[0]![0] as {
      override: { recipientName: string };
    };
    expect(args.override.recipientName).toBe('коллега');
  });

  it('хранилище упало не ошибкой — в журнал всё равно попадает причина', async () => {
    download.mockRejectedValue('строка вместо ошибки');
    const f = fake();
    const res = await sendDocumentToCustomer(f.prisma, staff(), 'doc-1');

    expect(res).toMatchObject({ ok: true, attached: false });
    expect(warn).toHaveBeenCalled();
  });

  it('руководитель и администратор отправляют так же, как менеджер', async () => {
    for (const role of ['leader', 'admin']) {
      vi.clearAllMocks();
      sendOrgDocumentSentEmail.mockResolvedValue({ status: 'sent', id: 'm' });
      setDocumentStatus.mockResolvedValue({ ok: true });
      getTemplateOverride.mockResolvedValue(null);
      download.mockResolvedValue(Buffer.from('%PDF'));
      canReadDocument.mockResolvedValue(true);
      const f = fake();
      const res = await sendDocumentToCustomer(f.prisma, staff(role), 'doc-1');
      expect(res.ok, role).toBe(true);
    }
  });
});
