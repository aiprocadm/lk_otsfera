/**
 * Track E / phase-2 coverage for src/lib/email/send.tsx.
 *
 * Drives `send()` through all four outcomes (no-recipient / disabled /
 * no-api-key / sent) and executes every `sendXxxEmail` wrapper once with
 * minimal valid props against an injected stub transport. Exercising a wrapper
 * also runs `renderHtml` (the dynamic `import('react-dom/server')`).
 *
 * Mirrors src/__tests__/email.send.test.ts: node env, injected stub transport
 * (no network / no Resend), EMAIL_ENABLED toggled via process.env which is
 * saved/restored around each test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailTransport } from '@/lib/email/transport';
import { resetEmailTransportCache } from '@/lib/email/transport';

// Настройки почты читаются через lib/config; в unit-тесте эмулируем env-fallback.
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/config/integrationSettings', () => ({
  getSettingValue: async (_p: unknown, key: string) => {
    const map: Record<string, string | undefined> = {
      'email.from': process.env.EMAIL_FROM,
      'email.enabled': process.env.EMAIL_ENABLED,
      'email.resendApiKey': process.env.RESEND_API_KEY
    };
    return map[key]?.trim() || null;
  }
}));
import {
  send,
  sendNotificationEmail,
  sendCommissionReadyEmail,
  sendLeadPromotedEmail,
  sendDocumentUploadedEmail,
  sendOrgInviteEmail,
  sendOrgDocumentPublishedEmail,
  sendOrgPaymentReceivedEmail,
  sendOrgOrderStatusChangedEmail,
  sendOrgManagerRepliedEmail,
  sendManagerCommentFromOrgEmail,
  sendManagerDocumentUploadedByOrgEmail,
  sendManagerOrderMarkedPaidBy1CEmail,
  sendManagerOrderStatusChangedEmail,
  sendManagerInviteEmail,
  sendAdminUserInviteEmail,
  sendPartnerDocumentPublishedEmail,
  sendManagerDocumentUploadedByPartnerEmail,
} from '@/lib/email/send';

function makeTransport(): EmailTransport & {
  calls: Array<Parameters<EmailTransport['send']>[0]>;
} {
  const calls: Array<Parameters<EmailTransport['send']>[0]> = [];
  return {
    calls,
    async send(input) {
      calls.push(input);
      return { id: 'msg_test' };
    },
  };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.EMAIL_ENABLED;
  resetEmailTransportCache();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetEmailTransportCache();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// send() — all four outcomes
// ---------------------------------------------------------------------------
describe('send() outcomes', () => {
  it('no-recipient: empty "to" short-circuits before any transport', async () => {
    process.env.EMAIL_ENABLED = 'true';
    const transport = makeTransport();
    const result = await send(
      { to: '', subject: 'x', html: '<p>x</p>' },
      { transport },
    );
    expect(result).toEqual({ status: 'skipped', reason: 'no-recipient' });
    expect(transport.calls).toHaveLength(0);
  });

  it('disabled: EMAIL_ENABLED unset → isEmailEnabled false', async () => {
    const transport = makeTransport();
    const result = await send(
      { to: 'a@b.com', subject: 'x', html: '<p>x</p>' },
      { transport },
    );
    expect(result).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(transport.calls).toHaveLength(0);
  });

  it('no-api-key: enabled, no injected transport, defaultTransport() null → warns', async () => {
    process.env.EMAIL_ENABLED = 'true';
    // RESEND_API_KEY absent (deleted in beforeEach) → defaultTransport() null.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await send({ to: 'a@b.com', subject: 'x', html: '<p>x</p>' });
    expect(result).toEqual({ status: 'skipped', reason: 'no-api-key' });
    expect(warn).toHaveBeenCalledWith(
      '[email] отправка включена, но не задан ключ Resend — письмо пропущено',
    );
  });

  it('sent: injected stub transport returns id, from/to/subject forwarded', async () => {
    process.env.EMAIL_ENABLED = 'true';
    const transport = makeTransport();
    const result = await send(
      { to: 'a@b.com', subject: 'Hi', html: '<p>x</p>', text: 'x' },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0]).toMatchObject({
      from: 'no-reply@otsfera.ru',
      to: 'a@b.com',
      subject: 'Hi',
      html: '<p>x</p>',
      text: 'x',
    });
  });
});

// ---------------------------------------------------------------------------
// Every sendXxxEmail wrapper — minimal valid props + injected stub transport
// ---------------------------------------------------------------------------
describe('sendXxxEmail wrappers', () => {
  beforeEach(() => {
    process.env.EMAIL_ENABLED = 'true';
  });

  it('sendNotificationEmail', async () => {
    const transport = makeTransport();
    const result = await sendNotificationEmail(
      {
        to: 'u@x.ru',
        recipientName: 'Иван',
        title: 'Заголовок',
        body: 'Текст',
        url: 'https://lk.otsfera.ru/x',
      },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0].html).toMatch(/^<!DOCTYPE html>/);
  });

  it('sendCommissionReadyEmail', async () => {
    const transport = makeTransport();
    const result = await sendCommissionReadyEmail(
      {
        to: 'p@x.ru',
        partnerName: 'Партнёр',
        period: '2026-04',
        amount: '125 000 ₽',
        url: 'https://lk.otsfera.ru/finance',
      },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0].subject).toBe('Отчёт по комиссии за 2026-04 готов');
  });

  it('sendLeadPromotedEmail', async () => {
    const transport = makeTransport();
    const result = await sendLeadPromotedEmail(
      {
        to: 'p@x.ru',
        partnerName: 'Партнёр',
        leadSubject: 'Покупка',
        orderNumber: 'ORD-1',
        url: 'https://lk.otsfera.ru/deals',
      },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0].subject).toBe('Заявка стала заказом ORD-1');
  });

  it('sendDocumentUploadedEmail', async () => {
    const transport = makeTransport();
    const result = await sendDocumentUploadedEmail(
      {
        to: 'p@x.ru',
        partnerName: 'Партнёр',
        orderNumber: 'ORD-7',
        filename: 'spec.pdf',
        url: 'https://lk.otsfera.ru/deals/7',
      },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0].subject).toBe('Новый документ по заказу ORD-7');
  });

  it('sendOrgInviteEmail', async () => {
    const transport = makeTransport();
    const result = await sendOrgInviteEmail(
      {
        to: 'o@x.ru',
        organizationName: 'ООО Ромашка',
        inviteUrl: 'https://lk.otsfera.ru/invite/1',
      },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0].subject).toBe('Приглашение в кабинет «ООО Ромашка»');
  });

  it('sendOrgDocumentPublishedEmail', async () => {
    const transport = makeTransport();
    const result = await sendOrgDocumentPublishedEmail(
      {
        to: 'o@x.ru',
        organizationName: 'ООО Ромашка',
        orderNumber: 'ORD-9',
        orderTitle: null,
        documentName: 'act.pdf',
        documentType: 'act',
        orderUrl: 'https://lk.otsfera.ru/org/orders/9',
      },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0].subject).toBe('Новый документ по заказу № ORD-9');
  });

  it('sendOrgPaymentReceivedEmail', async () => {
    const transport = makeTransport();
    const result = await sendOrgPaymentReceivedEmail(
      {
        to: 'o@x.ru',
        organizationName: 'ООО Ромашка',
        orderNumber: 'ORD-9',
        orderTitle: 'Заказ',
        amount: '50000',
        paidAt: new Date('2026-04-01T00:00:00Z'),
        orderUrl: 'https://lk.otsfera.ru/org/orders/9',
      },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0].subject).toContain('Оплата');
  });

  it('sendOrgOrderStatusChangedEmail', async () => {
    const transport = makeTransport();
    const result = await sendOrgOrderStatusChangedEmail(
      {
        to: 'o@x.ru',
        organizationName: 'ООО Ромашка',
        orderNumber: 'ORD-9',
        orderTitle: 'Заказ',
        dimension: 'execution',
        oldStatus: 'pending',
        newStatus: 'in_progress',
        orderUrl: 'https://lk.otsfera.ru/org/orders/9',
      },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0].subject).toContain('ORD-9');
  });

  it('sendOrgManagerRepliedEmail', async () => {
    const transport = makeTransport();
    const result = await sendOrgManagerRepliedEmail(
      {
        to: 'o@x.ru',
        organizationName: 'ООО Ромашка',
        orderNumber: 'ORD-9',
        orderTitle: 'Заказ',
        commentExcerpt: 'Готово',
        orderUrl: 'https://lk.otsfera.ru/org/orders/9',
      },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0].subject).toBe('Менеджер ответил по заказу № ORD-9');
  });

  it('sendManagerCommentFromOrgEmail', async () => {
    const transport = makeTransport();
    const result = await sendManagerCommentFromOrgEmail(
      {
        to: 'm@x.ru',
        orgName: 'ООО Ромашка',
        orderNumber: 'ORD-9',
        commentExcerpt: 'Вопрос',
        orderUrl: 'https://lk.otsfera.ru/manager/orders/9',
      },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0].subject).toContain('ORD-9');
  });

  it('sendManagerDocumentUploadedByOrgEmail', async () => {
    const transport = makeTransport();
    const result = await sendManagerDocumentUploadedByOrgEmail(
      {
        to: 'm@x.ru',
        orgName: 'ООО Ромашка',
        orderNumber: 'ORD-9',
        documentName: 'act.pdf',
        documentType: 'act',
        orderUrl: 'https://lk.otsfera.ru/manager/orders/9',
      },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0].subject).toContain('act.pdf');
  });

  it('sendManagerOrderMarkedPaidBy1CEmail', async () => {
    const transport = makeTransport();
    const result = await sendManagerOrderMarkedPaidBy1CEmail(
      {
        to: 'm@x.ru',
        orderNumber: 'ORD-9',
        amount: 50000,
        paidAt: new Date('2026-04-01T00:00:00Z'),
        orderUrl: 'https://lk.otsfera.ru/manager/orders/9',
      },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0].subject).toContain('ORD-9');
  });

  it('sendManagerOrderStatusChangedEmail', async () => {
    const transport = makeTransport();
    const result = await sendManagerOrderStatusChangedEmail(
      {
        to: 'm@x.ru',
        orderNumber: 'ORD-9',
        actorName: 'Пётр',
        oldStatus: 'В работе',
        newStatus: 'Завершён',
        orderUrl: 'https://lk.otsfera.ru/manager/orders/9',
      },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0].subject).toContain('ORD-9');
  });

  it('sendManagerInviteEmail', async () => {
    const transport = makeTransport();
    const result = await sendManagerInviteEmail(
      {
        to: 'm@x.ru',
        organizationName: 'ООО Ромашка',
        inviteUrl: 'https://lk.otsfera.ru/invite/2',
      },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0].subject).toBe(
      'Приглашение в кабинет менеджера «ООО Ромашка»',
    );
  });

  it('sendAdminUserInviteEmail', async () => {
    const transport = makeTransport();
    const result = await sendAdminUserInviteEmail(
      {
        to: 'a@x.ru',
        inviteUrl: 'https://lk.otsfera.ru/invite/3',
        name: 'Админ',
        role: 'manager',
      },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0].subject).toBe('Приглашение в кабинет Промтехносферы');
  });

  it('sendPartnerDocumentPublishedEmail', async () => {
    const transport = makeTransport();
    const result = await sendPartnerDocumentPublishedEmail(
      {
        to: 'p@x.ru',
        partnerName: 'Партнёр',
        orderNumber: 'ORD-9',
        orderTitle: null,
        documentName: 'act.pdf',
        documentType: 'act',
        orderUrl: 'https://lk.otsfera.ru/partner/orders/9',
      },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0].subject).toContain('act.pdf');
  });

  it('sendManagerDocumentUploadedByPartnerEmail', async () => {
    const transport = makeTransport();
    const result = await sendManagerDocumentUploadedByPartnerEmail(
      {
        to: 'm@x.ru',
        partnerName: 'Партнёр',
        orderNumber: 'ORD-9',
        documentName: 'act.pdf',
        documentType: 'act',
        orderUrl: 'https://lk.otsfera.ru/manager/orders/9',
      },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0].subject).toContain('act.pdf');
  });
});
