/**
 * Coverage completion (Track E / phase-2) for shared partner / password-reset
 * email surfaces:
 *  - src/lib/email/templates/partner/document-published.tsx (never rendered
 *    elsewhere — F0 on the component)
 *  - src/lib/email/templates/password-reset.tsx (rendered only inside a route)
 *  - src/lib/email/send.tsx sendPartnerDocumentPublishedEmail /
 *    sendManagerDocumentUploadedByPartnerEmail dispatch branches
 *
 * @vitest-environment node
 *
 * Transport is a hand-injected fake (mirrors email.send.test.ts) so nothing
 * touches the network / Resend SDK.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import type { EmailTransport } from '@/lib/email/transport';
import { resetEmailTransportCache } from '@/lib/email/transport';
import {
  PartnerDocumentPublished,
  partnerDocumentPublishedSubject,
  partnerDocumentPublishedText,
} from '@/lib/email/templates';
import {
  PasswordResetTemplate,
  passwordResetSubject,
  passwordResetText,
} from '@/lib/email/templates/password-reset';
import {
  sendPartnerDocumentPublishedEmail,
  sendManagerDocumentUploadedByPartnerEmail,
} from '@/lib/email/send';

// CI-джоб unit-тестов живёт без DATABASE_URL: реальный getSettingValue при
// недоступной базе бросает PrismaClientInitializationError раньше env-fallback,
// и send() → isEmailEnabled() ронял этот файл только в CI (локально живой
// Postgres маскировал утечку unit-слоя в БД). Настройки здесь читаем env-only;
// сам путь «БД → env» — предмет config.integrationSettings-тестов, не этого файла.
vi.mock('@/lib/config/integrationSettings', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/config/integrationSettings')>();
  return {
    ...mod,
    getSettingValue: async (_prisma: unknown, key: keyof typeof mod.SETTING_SPECS) =>
      process.env[mod.SETTING_SPECS[key].envVar]?.trim() || null,
  };
});

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

describe('PartnerDocumentPublished template', () => {
  it('renders with orderNumber (known doc type) — resolves № ref and type label', () => {
    const html = renderToStaticMarkup(
      React.createElement(PartnerDocumentPublished, {
        partnerName: 'ООО Партнёр',
        orderNumber: 'ORD-2026-0042',
        orderTitle: 'Игнор',
        documentName: 'contract.pdf',
        documentType: 'contract',
        orderUrl: 'https://lk.otsfera.ru/partner/deals/ord-1',
      })
    );
    expect(html).toContain('№ ORD-2026-0042');
    expect(html).toContain('договор');
    expect(html).toContain('«contract.pdf»');
    expect(html).toContain('Открыть портфолио');
    expect(html).toContain('https://lk.otsfera.ru/partner/deals/ord-1');
  });

  it('falls back to orderTitle when orderNumber is null (unknown doc type → документ)', () => {
    const html = renderToStaticMarkup(
      React.createElement(PartnerDocumentPublished, {
        partnerName: 'ООО Партнёр',
        orderNumber: null,
        orderTitle: 'Курс по охране труда',
        documentName: 'scan.pdf',
        documentType: 'unmapped_kind',
        orderUrl: 'https://lk.otsfera.ru/x',
      })
    );
    expect(html).toContain('«Курс по охране труда»');
    // Unknown documentType falls back to the generic label.
    expect(html).toContain('загружен документ');
    expect(html).toContain('«scan.pdf»');
  });

  it('falls back to «(без заказа)» when both orderNumber and orderTitle are null', () => {
    const html = renderToStaticMarkup(
      React.createElement(PartnerDocumentPublished, {
        partnerName: 'ООО Партнёр',
        orderNumber: null,
        orderTitle: null,
        documentName: 'a.pdf',
        documentType: 'act',
        orderUrl: 'https://lk.otsfera.ru/y',
      })
    );
    expect(html).toContain('(без заказа)');
    expect(html).toContain('акт');
  });
});

describe('partnerDocumentPublishedSubject', () => {
  it('prefers orderNumber', () => {
    expect(
      partnerDocumentPublishedSubject({
        partnerName: 'P',
        orderNumber: '999',
        orderTitle: 'T',
        documentName: 'd.pdf',
        documentType: 'other',
        orderUrl: 'u',
      })
    ).toBe('Новый документ d.pdf по заказу № 999');
  });

  it('falls back to orderTitle when orderNumber is null', () => {
    expect(
      partnerDocumentPublishedSubject({
        partnerName: 'P',
        orderNumber: null,
        orderTitle: 'Мой заказ',
        documentName: 'd.pdf',
        documentType: 'other',
        orderUrl: 'u',
      })
    ).toBe('Новый документ d.pdf по заказу «Мой заказ»');
  });

  it('falls back to (без заказа) when both are null', () => {
    expect(
      partnerDocumentPublishedSubject({
        partnerName: 'P',
        orderNumber: null,
        orderTitle: null,
        documentName: 'd.pdf',
        documentType: 'other',
        orderUrl: 'u',
      })
    ).toBe('Новый документ d.pdf по заказу (без заказа)');
  });
});

describe('partnerDocumentPublishedText', () => {
  it('includes known type label, № ref, and the portfolio link (orderNumber path)', () => {
    const text = partnerDocumentPublishedText({
      partnerName: 'P',
      orderNumber: 'ORD-5',
      orderTitle: 'T',
      documentName: 'invoice.pdf',
      documentType: 'invoice',
      orderUrl: 'https://lk.otsfera.ru/z',
    });
    expect(text).toContain('По заказу № ORD-5 загружен счёт «invoice.pdf».');
    expect(text).toContain('счёт');
    expect(text).toContain('Открыть портфолио: https://lk.otsfera.ru/z');
  });

  it('uses orderTitle ref and generic label for unknown type', () => {
    const text = partnerDocumentPublishedText({
      partnerName: 'P',
      orderNumber: null,
      orderTitle: 'Заголовок',
      documentName: 'x.pdf',
      documentType: 'weird',
      orderUrl: 'https://u',
    });
    expect(text).toContain('«Заголовок»');
    expect(text).toContain('документ «x.pdf»');
  });

  it('uses (без заказа) when both refs are null', () => {
    const text = partnerDocumentPublishedText({
      partnerName: 'P',
      orderNumber: null,
      orderTitle: null,
      documentName: 'x.pdf',
      documentType: 'report',
      orderUrl: 'https://u',
    });
    expect(text).toContain('(без заказа)');
    expect(text).toContain('отчёт');
  });
});

describe('PasswordResetTemplate', () => {
  it('renders name, CTA button, and the reset url', () => {
    const html = renderToStaticMarkup(
      React.createElement(PasswordResetTemplate, {
        name: 'Иван',
        resetUrl: 'https://lk.otsfera.ru/reset-password?token=abc',
      })
    );
    expect(html).toContain('Здравствуйте, Иван!');
    expect(html).toContain('Установить пароль');
    expect(html).toContain('https://lk.otsfera.ru/reset-password?token=abc');
    expect(html).toContain('Восстановление пароля');
  });

  it('passwordResetSubject is the fixed heading', () => {
    expect(passwordResetSubject()).toBe('Восстановление пароля');
  });

  it('passwordResetText includes greeting and the raw url', () => {
    const text = passwordResetText({
      name: 'Мария',
      resetUrl: 'https://lk.otsfera.ru/reset-password?token=xyz',
    });
    expect(text).toContain('Здравствуйте, Мария!');
    expect(text).toContain('https://lk.otsfera.ru/reset-password?token=xyz');
    expect(text).toContain('просто проигнорируйте это письмо');
  });
});

describe('sendPartnerDocumentPublishedEmail()', () => {
  it('dispatches with subject/html/text built from props (orderNumber ref)', async () => {
    process.env.EMAIL_ENABLED = 'true';
    const transport = makeTransport();
    const result = await sendPartnerDocumentPublishedEmail(
      {
        to: 'partner@x.ru',
        partnerName: 'ООО Партнёр',
        orderNumber: 'ORD-2026-0042',
        orderTitle: 'Курс',
        documentName: 'contract.pdf',
        documentType: 'contract',
        orderUrl: 'https://lk.otsfera.ru/partner/deals/ord-1',
      },
      { transport }
    );

    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    const call = transport.calls[0];
    expect(call.to).toBe('partner@x.ru');
    expect(call.subject).toBe('Новый документ contract.pdf по заказу № ORD-2026-0042');
    expect(call.html).toMatch(/^<!DOCTYPE html>/);
    expect(call.html).toContain('№ ORD-2026-0042');
    expect(call.html).toContain('«contract.pdf»');
    expect(call.text).toContain('Открыть портфолио: https://lk.otsfera.ru/partner/deals/ord-1');
  });

  it('builds subject from orderTitle when orderNumber is null', async () => {
    process.env.EMAIL_ENABLED = 'true';
    const transport = makeTransport();
    await sendPartnerDocumentPublishedEmail(
      {
        to: 'partner@x.ru',
        partnerName: 'ООО Партнёр',
        orderNumber: null,
        orderTitle: 'Мой заказ',
        documentName: 'a.pdf',
        documentType: 'other',
        orderUrl: 'https://lk.otsfera.ru/y',
      },
      { transport }
    );
    expect(transport.calls[0].subject).toBe('Новый документ a.pdf по заказу «Мой заказ»');
  });
});

describe('sendManagerDocumentUploadedByPartnerEmail()', () => {
  it('dispatches with manager-facing subject/html/text', async () => {
    process.env.EMAIL_ENABLED = 'true';
    const transport = makeTransport();
    const result = await sendManagerDocumentUploadedByPartnerEmail(
      {
        to: 'manager@x.ru',
        partnerName: 'ООО Партнёр',
        orderNumber: 'ORD-007',
        documentName: 'spec.pdf',
        documentType: 'act',
        orderUrl: 'https://lk.otsfera.ru/manager/orders/ord-007',
      },
      { transport }
    );

    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    const call = transport.calls[0];
    expect(call.to).toBe('manager@x.ru');
    expect(call.subject).toBe('ООО Партнёр загрузил документ spec.pdf к заказу № ORD-007');
    expect(call.html).toMatch(/^<!DOCTYPE html>/);
    expect(call.html).toContain('ООО Партнёр');
    expect(call.html).toContain('«spec.pdf»');
    expect(call.html).toContain('№ ORD-007');
    expect(call.text).toContain('Открыть заказ: https://lk.otsfera.ru/manager/orders/ord-007');
    expect(call.text).toContain('акт');
  });
});
