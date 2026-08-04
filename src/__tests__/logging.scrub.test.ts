/**
 * scrub / scrubString / scrubSentryEvent — редакция ПДн и секретов (PR-2).
 * Контракт: чувствительные ключи → [REDACTED]; JWT/односразовые token=/code=
 * в URL/email — вычищаются из строк; Error сводится к {name,message,stack};
 * циклы и глубина ограничены; Sentry-событие теряет cookies/user/query_string.
 */
import { describe, expect, it } from 'vitest';
import { REDACTED, scrub, scrubSentryEvent, scrubString } from '@/lib/logging/scrub';

describe('scrubString', () => {
  it('вычищает JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
    expect(scrubString(`token: ${jwt}!`)).toBe(`token: ${REDACTED}!`);
  });

  it('вычищает одноразовые параметры URL (token=, code=), сохраняя остальные', () => {
    expect(scrubString('https://lk/reset-password?token=abc123&x=1')).toBe(
      `https://lk/reset-password?token=${REDACTED}&x=1`
    );
    expect(scrubString('/student/bridge?code=uuid-value')).toBe(`/student/bridge?code=${REDACTED}`);
  });

  it('вычищает email-адреса в свободном тексте', () => {
    expect(scrubString('Resend: delivery to user@example.ru failed')).toBe(
      `Resend: delivery to ${REDACTED} failed`
    );
  });

  it('не трогает безопасный текст', () => {
    expect(scrubString('[sync-orders] cursor advanced')).toBe('[sync-orders] cursor advanced');
  });
});

describe('scrub', () => {
  it('примитивы проходят как есть, строки скрабятся', () => {
    expect(scrub(42)).toBe(42);
    expect(scrub(null)).toBeNull();
    expect(scrub(undefined)).toBeUndefined();
    expect(scrub(true)).toBe(true);
    expect(scrub('mail me: a@b.ru')).toBe(`mail me: ${REDACTED}`);
  });

  it('редактирует чувствительные ключи точным совпадением (без учёта регистра)', () => {
    expect(scrub({ email: 'a@b.ru', Name: 'Иванов', token: 'x', orderId: 'o1' })).toEqual({
      email: REDACTED,
      Name: REDACTED,
      token: REDACTED,
      orderId: 'o1',
    });
  });

  it('редактирует по суффиксу (userEmail), но не ложные срабатывания (statusCode, queueName)', () => {
    expect(scrub({ userEmail: 'a@b.ru', statusCode: 404, queueName: 'emails.send' })).toEqual({
      userEmail: REDACTED,
      statusCode: 404,
      queueName: 'emails.send',
    });
  });

  it('рекурсивно обрабатывает вложенные объекты и массивы', () => {
    expect(scrub({ a: [{ phone: '+7900' }, 'x@y.ru'], b: { inviteUrl: 'https://…' } })).toEqual({
      a: [{ phone: REDACTED }, REDACTED],
      b: { inviteUrl: REDACTED },
    });
  });

  it('Error → {name, message, stack} со скрабом строк', () => {
    const err = new Error('SMTP: recipient user@example.ru rejected');
    const out = scrub(err) as { name: string; message: string; stack?: string };
    expect(out.name).toBe('Error');
    expect(out.message).toBe(`SMTP: recipient ${REDACTED} rejected`);
    expect(out.stack).toContain('Error');
  });

  it('Error без stack — stack undefined', () => {
    const err = new Error('boom');
    // Убираем stack удалением свойства: `err.stack = undefined` не проходит при
    // exactOptionalPropertyTypes, а scrub всё равно читает `value.stack ? … : undefined`.
    delete err.stack;
    expect(scrub(err)).toEqual({ name: 'Error', message: 'boom', stack: undefined });
  });

  it('Date → ISO-строка', () => {
    expect(scrub({ at: new Date('2026-07-09T00:00:00Z') })).toEqual({
      at: '2026-07-09T00:00:00.000Z',
    });
  });

  it('циклическая ссылка → [Circular]', () => {
    const a: Record<string, unknown> = { id: 1 };
    a.self = a;
    expect(scrub(a)).toEqual({ id: 1, self: '[Circular]' });
  });

  it('глубина ограничена → [MaxDepth]', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 'far' } } } } } } };
    expect(scrub(deep)).toEqual({ a: { b: { c: { d: { e: { f: '[MaxDepth]' } } } } } });
  });

  it('исходный объект не мутируется', () => {
    const src = { email: 'a@b.ru' };
    scrub(src);
    expect(src.email).toBe('a@b.ru');
  });
});

describe('scrubSentryEvent', () => {
  it('чистит message, exception, breadcrumbs, extra, contexts и удаляет user/cookies/query_string', () => {
    const event = {
      message: 'user a@b.ru failed',
      request: {
        url: 'https://lk/api?token=secret1',
        query_string: 'token=secret1',
        cookies: { session: 'jwt' },
        headers: { Authorization: 'Bearer x', 'x-request-id': 'r1' },
        data: { email: 'a@b.ru' },
      },
      exception: { values: [{ value: 'sent to a@b.ru' }, {}] },
      breadcrumbs: [{ message: 'mail a@b.ru', data: { to: 'a@b.ru' } }, {}],
      extra: { inviteUrl: 'https://…' },
      contexts: { job: { token: 'x' } },
      user: { id: 'u1' },
    };
    const out = scrubSentryEvent(event);
    expect(out.message).toBe(`user ${REDACTED} failed`);
    expect(out.request?.url).toBe(`https://lk/api?token=${REDACTED}`);
    expect(out.request).not.toHaveProperty('cookies');
    expect(out.request).not.toHaveProperty('query_string');
    expect(out.request?.headers).toEqual({ Authorization: REDACTED, 'x-request-id': 'r1' });
    expect(out.request?.data).toEqual({ email: REDACTED });
    expect(out.exception?.values?.[0].value).toBe(`sent to ${REDACTED}`);
    expect(out.exception?.values?.[1].value).toBeUndefined();
    expect(out.breadcrumbs?.[0]).toEqual({ message: `mail ${REDACTED}`, data: { to: REDACTED } });
    expect(out.extra).toEqual({ inviteUrl: REDACTED });
    expect(out.contexts).toEqual({ job: { token: REDACTED } });
    expect(out).not.toHaveProperty('user');
  });

  it('минимальное событие (все поля отсутствуют) проходит без изменений', () => {
    expect(scrubSentryEvent({})).toEqual({});
  });

  it('request без url/headers/data — только удаление cookies/query_string', () => {
    const out = scrubSentryEvent({ request: { cookies: 'c' } });
    expect(out.request).toEqual({});
  });
});
