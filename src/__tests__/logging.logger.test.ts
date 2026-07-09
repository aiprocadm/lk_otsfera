/**
 * @/lib/logging/logger — двухтранспортный логгер (PR-2):
 *  - console-режим (dev/test): verbatim passthrough в console.* (info→log),
 *    лукап console.X в момент вызова (vi.spyOn после импорта должен работать);
 *  - json-режим (prod): pino в destination, ctx через scrub(), child-байндинги;
 *  - выбор режима из env (LOG_FORMAT / NODE_ENV) при импорте модуля.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, log, REDACTED } from '@/lib/logging';
import { modeFromEnv } from '@/lib/logging/logger';

function captureSink() {
  const lines: string[] = [];
  return {
    lines,
    dest: { write: (s: string) => void lines.push(s) },
    parsed: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>)
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('console-режим (dev/test passthrough)', () => {
  it.each([
    ['debug', 'debug'],
    ['info', 'log'], // worker-тесты прибиты к console.log для start/done
    ['warn', 'warn'],
    ['error', 'error']
  ] as const)('%s → console.%s c verbatim-аргументами', (method, sink) => {
    const spy = vi.spyOn(console, sink).mockImplementation(() => {});
    const l = createLogger({ mode: 'console' });
    const err = new Error('x');
    l[method]('[tag] failed', err);
    expect(spy).toHaveBeenCalledWith('[tag] failed', err); // тот же объект, без скраба
  });

  it('без аргументов — только сообщение', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createLogger({ mode: 'console' }).warn('solo');
    expect(spy).toHaveBeenCalledWith('solo');
  });

  it('child добавляет байндинги хвостовым аргументом и наследуется', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const child = createLogger({ mode: 'console' }).child({ requestId: 'r1' });
    child.error('boom', 1);
    expect(spy).toHaveBeenCalledWith('boom', 1, { requestId: 'r1' });
    child.child({ jobId: 'j1' }).error('deep');
    expect(spy).toHaveBeenCalledWith('deep', { requestId: 'r1', jobId: 'j1' });
  });

  it('пустые байндинги не добавляют хвостовой аргумент', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createLogger({ mode: 'console', bindings: {} }).info('plain');
    expect(spy).toHaveBeenCalledWith('plain');
  });

  it('vi.spyOn, поставленный ПОСЛЕ импорта модуля, перехватывает вызовы (live lookup)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log.warn('[late-spy] works');
    expect(spy).toHaveBeenCalledWith('[late-spy] works');
  });
});

describe('json-режим (pino)', () => {
  it('пишет JSON с msg и скрабит ctx (email/чувствительные ключи)', () => {
    const { dest, parsed } = captureSink();
    const l = createLogger({ mode: 'json', destination: dest });
    l.warn('[email] Resend API error', { to: 'user@example.ru', error: 'boom' });
    const [rec] = parsed();
    expect(rec.msg).toBe('[email] Resend API error');
    expect(rec.ctx).toEqual({ to: REDACTED, error: 'boom' });
  });

  it('несколько аргументов пакуются в ctx-массив; без аргументов ctx отсутствует', () => {
    const { dest, parsed } = captureSink();
    const l = createLogger({ mode: 'json', destination: dest });
    l.error('multi', 1, 'a@b.ru');
    l.info('solo');
    const [multi, solo] = parsed();
    expect(multi.ctx).toEqual([1, REDACTED]);
    expect(solo).not.toHaveProperty('ctx');
  });

  it('уровень фильтрует записи (level=warn → info молчит), debug проходит при level=debug', () => {
    const { dest, parsed } = captureSink();
    const l = createLogger({ mode: 'json', level: 'warn', destination: dest });
    l.info('quiet');
    l.warn('loud');
    expect(parsed()).toHaveLength(1);

    const dbg = captureSink();
    createLogger({ mode: 'json', level: 'debug', destination: dbg.dest }).debug('verbose');
    expect(dbg.parsed()[0].msg).toBe('verbose');
  });

  it('bindings попадают в каждую запись, child скрабит свои байндинги', () => {
    const { dest, parsed } = captureSink();
    const l = createLogger({ mode: 'json', destination: dest, bindings: { proc: 'worker' } });
    l.child({ jobId: 'j1', email: 'a@b.ru' }).info('done');
    const [rec] = parsed();
    expect(rec.proc).toBe('worker');
    expect(rec.jobId).toBe('j1');
    expect(rec.email).toBe(REDACTED);
  });
});

describe('modeFromEnv — выбор транспорта из окружения', () => {
  it('LOG_FORMAT=json → json (даже вне production)', () => {
    vi.stubEnv('LOG_FORMAT', 'json');
    vi.stubEnv('NODE_ENV', 'test');
    expect(modeFromEnv()).toBe('json');
  });

  it('LOG_FORMAT=console → console (даже в production)', () => {
    vi.stubEnv('LOG_FORMAT', 'console');
    vi.stubEnv('NODE_ENV', 'production');
    expect(modeFromEnv()).toBe('console');
  });

  it('без LOG_FORMAT: production → json, иначе → console', () => {
    vi.stubEnv('LOG_FORMAT', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(modeFromEnv()).toBe('json');
    vi.stubEnv('NODE_ENV', 'test');
    expect(modeFromEnv()).toBe('console');
  });
});
