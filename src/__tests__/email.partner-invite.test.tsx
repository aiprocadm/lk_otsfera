/**
 * Unit tests for the partner-invite email surface (этап 4, ФТ-10.1):
 *  - src/lib/email/templates/partner/partner-invite.tsx — шаблон, subject, text;
 *  - sendPartnerInviteEmail в src/lib/email/send.tsx — диспатч через
 *    hand-injected transport (без сети/Resend SDK).
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import type { EmailTransport } from '@/lib/email/transport';
import { resetEmailTransportCache } from '@/lib/email/transport';
import {
  PartnerInviteTemplate,
  partnerInviteSubject,
  partnerInviteText
} from '@/lib/email/templates/partner/partner-invite';
import { sendPartnerInviteEmail } from '@/lib/email/send';

// CI-джоб unit-тестов живёт без DATABASE_URL: реальный getSettingValue при
// недоступной базе бросает PrismaClientInitializationError раньше env-fallback.
// Настройки читаем env-only (паттерн cov.email-partner-shared.test.tsx).
vi.mock('@/lib/config/integrationSettings', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/config/integrationSettings')>();
  return {
    ...mod,
    getSettingValue: async (_prisma: unknown, key: keyof typeof mod.SETTING_SPECS) =>
      process.env[mod.SETTING_SPECS[key].envVar]?.trim() || null
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
    }
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

const BASE_PROPS = {
  partnerName: 'ООО Партнёр',
  roleLabel: 'менеджер',
  inviteUrl: 'https://lk.otsfera.ru/reset-password?token=abc123'
};

describe('PartnerInviteTemplate', () => {
  it('рендерит имя партнёра, роль, кнопку и срок «7 дн.» по умолчанию', () => {
    const html = renderToStaticMarkup(<PartnerInviteTemplate {...BASE_PROPS} />);
    expect(html).toContain('Приглашение в кабинет партнёра');
    expect(html).toContain('ООО Партнёр');
    expect(html).toContain('роль: менеджер');
    expect(html).toContain('Установить пароль');
    expect(html).toContain('https://lk.otsfera.ru/reset-password?token=abc123');
    // Дефолтный TTL invite-токена — 7 дней.
    expect(html).toContain('Ссылка действует 7 дн.');
    // Без invitedByName — обезличенное приглашение.
    expect(html).toContain('Вас приглашают');
  });

  it('с invitedByName — персональное приглашение', () => {
    const html = renderToStaticMarkup(
      <PartnerInviteTemplate {...BASE_PROPS} invitedByName='Иван Петров' />
    );
    expect(html).toContain('Иван Петров приглашает вас');
    expect(html).not.toContain('Вас приглашают');
  });

  it('expiresInDays переопределяет срок в подписи', () => {
    const html = renderToStaticMarkup(<PartnerInviteTemplate {...BASE_PROPS} expiresInDays={14} />);
    expect(html).toContain('Ссылка действует 14 дн.');
  });

  it('роль «администратор» попадает в текст письма', () => {
    const html = renderToStaticMarkup(
      <PartnerInviteTemplate {...BASE_PROPS} roleLabel='администратор' />
    );
    expect(html).toContain('роль: администратор');
  });
});

describe('partnerInviteSubject', () => {
  it('строит тему с именем партнёра в кавычках-ёлочках', () => {
    expect(partnerInviteSubject('ООО Партнёр')).toBe('Приглашение в команду «ООО Партнёр»');
  });
});

describe('partnerInviteText', () => {
  it('обезличенный вариант: интро, партнёр, роль, ссылка, срок 7 дн.', () => {
    const text = partnerInviteText(BASE_PROPS);
    expect(text).toContain('Здравствуйте!');
    expect(text).toContain(
      'Вас приглашают в команду партнёра «ООО Партнёр» на платформе Промтехносфера (роль: менеджер).'
    );
    expect(text).toContain('Установить пароль: https://lk.otsfera.ru/reset-password?token=abc123');
    expect(text).toContain('Ссылка действует 7 дн.');
  });

  it('с invitedByName и кастомным сроком', () => {
    const text = partnerInviteText({
      ...BASE_PROPS,
      roleLabel: 'администратор',
      invitedByName: 'Мария',
      expiresInDays: 3
    });
    expect(text).toContain('Мария приглашает вас в команду партнёра «ООО Партнёр»');
    expect(text).toContain('(роль: администратор)');
    expect(text).toContain('Ссылка действует 3 дн.');
  });
});

describe('sendPartnerInviteEmail()', () => {
  it('диспатчит subject/html/text, собранные из props', async () => {
    process.env.EMAIL_ENABLED = 'true';
    const transport = makeTransport();
    const result = await sendPartnerInviteEmail(
      {
        to: 'invitee@x.ru',
        partnerName: 'ООО Партнёр',
        roleLabel: 'администратор',
        inviteUrl: 'https://lk.otsfera.ru/reset-password?token=zzz',
        invitedByName: 'Иван'
      },
      { transport }
    );

    expect(result).toEqual({ status: 'sent', id: 'msg_test' });
    const call = transport.calls[0];
    expect(call.to).toBe('invitee@x.ru');
    expect(call.subject).toBe('Приглашение в команду «ООО Партнёр»');
    expect(call.html).toMatch(/^<!DOCTYPE html>/);
    expect(call.html).toContain('роль: администратор');
    expect(call.html).toContain('Иван приглашает вас');
    expect(call.html).toContain('https://lk.otsfera.ru/reset-password?token=zzz');
    expect(call.text).toContain('Установить пароль: https://lk.otsfera.ru/reset-password?token=zzz');
    expect(call.text).toContain('Ссылка действует 7 дн.');
  });

  it('email выключен (EMAIL_ENABLED не задан) → skipped, транспорт не зовётся', async () => {
    const transport = makeTransport();
    const result = await sendPartnerInviteEmail(
      { to: 'invitee@x.ru', ...BASE_PROPS },
      { transport }
    );
    expect(result.status).toBe('skipped');
    expect(transport.calls).toHaveLength(0);
  });
});
