import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailTransport } from '@/lib/email/transport';
import { resetEmailTransportCache } from '@/lib/email/transport';
import {
  send,
  sendCommissionReadyEmail,
  sendDocumentUploadedEmail,
  sendLeadPromotedEmail,
  sendNotificationEmail,
} from '@/lib/email/send';

function makeTransport(): EmailTransport & { calls: Array<Parameters<EmailTransport['send']>[0]> } {
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

describe('send()', () => {
  it('skips with no-recipient when "to" is empty', async () => {
    process.env.EMAIL_ENABLED = 'true';
    const transport = makeTransport();
    const result = await send(
      { to: '', subject: 'x', html: '<p>x</p>' },
      { transport },
    );
    expect(result).toEqual({ status: 'skipped', reason: 'no-recipient' });
    expect(transport.calls).toHaveLength(0);
  });

  it('skips with disabled when EMAIL_ENABLED is not "true"', async () => {
    const transport = makeTransport();
    const result = await send(
      { to: 'a@b.com', subject: 'x', html: '<p>x</p>' },
      { transport },
    );
    expect(result).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(transport.calls).toHaveLength(0);
  });

  it('skips with no-api-key when enabled but no transport is configured', async () => {
    process.env.EMAIL_ENABLED = 'true';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await send({ to: 'a@b.com', subject: 'x', html: '<p>x</p>' });
    expect(result).toEqual({ status: 'skipped', reason: 'no-api-key' });
    expect(warn).toHaveBeenCalled();
  });

  it('uses default EMAIL_FROM when env unset', async () => {
    process.env.EMAIL_ENABLED = 'true';
    const transport = makeTransport();
    await send({ to: 'a@b.com', subject: 'x', html: '<p>x</p>' }, { transport });
    expect(transport.calls[0].from).toBe('no-reply@otsfera.ru');
  });

  it('honours custom EMAIL_FROM env', async () => {
    process.env.EMAIL_ENABLED = 'true';
    process.env.EMAIL_FROM = 'noreply@test.local';
    const transport = makeTransport();
    await send({ to: 'a@b.com', subject: 'x', html: '<p>x</p>' }, { transport });
    expect(transport.calls[0].from).toBe('noreply@test.local');
  });

  it('returns sent status with transport id', async () => {
    process.env.EMAIL_ENABLED = 'true';
    const transport = makeTransport();
    const result = await send(
      { to: 'a@b.com', subject: 'x', html: '<p>x</p>', text: 'x' },
      { transport },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    expect(transport.calls[0]).toMatchObject({
      to: 'a@b.com',
      subject: 'x',
      html: '<p>x</p>',
      text: 'x',
    });
  });
});

describe('sendCommissionReadyEmail()', () => {
  it('renders subject with period and html with partner name + amount + url', async () => {
    process.env.EMAIL_ENABLED = 'true';
    const transport = makeTransport();
    const result = await sendCommissionReadyEmail(
      {
        to: 'partner@x.ru',
        partnerName: 'ООО Альфа',
        period: '2026-04',
        amount: '125 000 ₽',
        url: 'https://lk.otsfera.ru/partner/finance/stmt-1',
      },
      { transport },
    );

    expect(result.status).toBe('sent');
    const call = transport.calls[0];
    expect(call.subject).toBe('Отчёт по комиссии за 2026-04 готов');
    expect(call.to).toBe('partner@x.ru');
    expect(call.html).toContain('ООО Альфа');
    expect(call.html).toContain('125 000 ₽');
    expect(call.html).toContain('https://lk.otsfera.ru/partner/finance/stmt-1');
    expect(call.html).toMatch(/^<!DOCTYPE html>/);
    expect(call.text).toContain('Открыть: https://lk.otsfera.ru/partner/finance/stmt-1');
  });
});

describe('sendLeadPromotedEmail()', () => {
  it('includes lead subject and order number in subject and html', async () => {
    process.env.EMAIL_ENABLED = 'true';
    const transport = makeTransport();
    await sendLeadPromotedEmail(
      {
        to: 'partner@x.ru',
        partnerName: 'Партнёр',
        leadSubject: 'Покупка станка',
        orderNumber: 'ORD-2026-0042',
        url: 'https://lk.otsfera.ru/partner/deals/ord-1',
      },
      { transport },
    );

    const call = transport.calls[0];
    expect(call.subject).toBe('Заявка стала заказом ORD-2026-0042');
    expect(call.html).toContain('Покупка станка');
    expect(call.html).toContain('ORD-2026-0042');
  });
});

describe('sendDocumentUploadedEmail()', () => {
  it('includes order number and filename', async () => {
    process.env.EMAIL_ENABLED = 'true';
    const transport = makeTransport();
    await sendDocumentUploadedEmail(
      {
        to: 'partner@x.ru',
        partnerName: 'Партнёр',
        orderNumber: 'ORD-007',
        filename: 'spec.pdf',
        url: 'https://lk.otsfera.ru/partner/deals/ord-007',
      },
      { transport },
    );

    const call = transport.calls[0];
    expect(call.subject).toBe('Новый документ по заказу ORD-007');
    expect(call.html).toContain('ORD-007');
    expect(call.html).toContain('spec.pdf');
  });
});

describe('sendNotificationEmail()', () => {
  it('uses title as subject and includes body + url in html', async () => {
    process.env.EMAIL_ENABLED = 'true';
    const transport = makeTransport();
    await sendNotificationEmail(
      {
        to: 'u@x.ru',
        recipientName: 'Иван',
        title: 'Смена статуса заказа',
        body: 'Заказ #42: в работе',
        url: 'https://lk.otsfera.ru/orders/42',
      },
      { transport },
    );

    const call = transport.calls[0];
    expect(call.subject).toBe('Смена статуса заказа');
    expect(call.html).toContain('Иван');
    expect(call.html).toContain('Заказ #42');
    expect(call.html).toContain('https://lk.otsfera.ru/orders/42');
    expect(call.text).toContain('Открыть: https://lk.otsfera.ru/orders/42');
  });

  it('omits CTA section when url is undefined', async () => {
    process.env.EMAIL_ENABLED = 'true';
    const transport = makeTransport();
    await sendNotificationEmail(
      {
        to: 'u@x.ru',
        recipientName: 'Иван',
        title: 'Хи',
        body: 'Привет',
      },
      { transport },
    );

    const call = transport.calls[0];
    expect(call.html).not.toContain('Открыть кабинет');
    expect(call.text).not.toContain('Открыть:');
  });
});
