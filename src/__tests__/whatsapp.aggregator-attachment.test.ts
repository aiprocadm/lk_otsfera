import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Разбор входящего вебхука агрегатора WhatsApp — файлы (`У-204`).
 *
 * Раньше сообщение считалось пригодным только при строковом `text`, и клиент,
 * приславший ОДИН документ без подписи, исчезал молча. Теперь годится текст
 * ИЛИ ссылка на файл; всё остальное (эхо наших же исходящих) по-прежнему
 * отбрасывается.
 */
const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

import { parseWazzupInbound } from '@/lib/whatsapp/aggregator';

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockReturnValue(true);
});

describe('parseWazzupInbound — сообщение с файлом', () => {
  it('файл без текста больше не отбрасывается: телом становится имя файла', () => {
    const out = parseWazzupInbound({
      messages: [
        {
          messageId: 'w1',
          chatId: '7 999 000-11-22',
          contentUri: 'https://cdn.wazzup24.com/files/scan.pdf',
          mimeType: 'application/pdf',
        },
      ],
    });
    expect(out).toEqual([
      {
        externalId: 'wa:w1',
        phone: '+79990001122',
        text: 'Файл: scan.pdf',
        name: undefined,
        attachment: {
          url: 'https://cdn.wazzup24.com/files/scan.pdf',
          name: 'scan.pdf',
          mimeType: 'application/pdf',
        },
      },
    ]);
  });

  it('имя файла берётся из ссылки и не включает параметры ?x=1', () => {
    const out = parseWazzupInbound({
      messages: [
        {
          messageId: 'w2',
          chatId: 79990001122,
          contentUri: 'https://cdn.wazzup24.com/f/act.pdf?x=1&sign=abc',
        },
      ],
    });
    expect(out[0]!.attachment).toEqual({
      url: 'https://cdn.wazzup24.com/f/act.pdf?x=1&sign=abc',
      name: 'act.pdf',
      mimeType: 'application/octet-stream',
    });
    expect(out[0]!.text).toBe('Файл: act.pdf');
  });

  it('имя в ссылке закодировано → раскодируется', () => {
    const out = parseWazzupInbound({
      messages: [
        {
          messageId: 'w3',
          chatId: '79990001122',
          contentUri: 'https://cdn.wazzup24.com/f/%D0%B0%D0%BA%D1%82.pdf',
        },
      ],
    });
    expect(out[0]!.attachment?.name).toBe('акт.pdf');
  });

  it('в ссылке нет похожего на имя файла → «file», сообщение всё равно живо', () => {
    const out = parseWazzupInbound({
      messages: [{ messageId: 'w4', chatId: '79990001122', contentUri: 'https://cdn.local/12345' }],
    });
    expect(out[0]!.text).toBe('Файл: file');
    expect(out[0]!.attachment?.name).toBe('file');
  });

  it('текст вместе с файлом: текст сохраняется, вложение тоже', () => {
    const out = parseWazzupInbound({
      messages: [
        {
          messageId: 'w5',
          chatId: '79990001122',
          text: 'вот акт',
          contentUri: 'https://cdn.local/f/act.pdf',
          mimeType: 'application/pdf',
          contact: { name: 'Иван' },
        },
      ],
    });
    expect(out[0]!.text).toBe('вот акт');
    expect(out[0]!.name).toBe('Иван');
    expect(out[0]!.attachment?.url).toBe('https://cdn.local/f/act.pdf');
  });

  it('пустой текст рядом с файлом → телом становится имя файла, а не пустая строка', () => {
    const out = parseWazzupInbound({
      messages: [
        {
          messageId: 'w6',
          chatId: '79990001122',
          text: '',
          contentUri: 'https://cdn.local/f/a.png',
        },
      ],
    });
    expect(out[0]!.text).toBe('Файл: a.png');
  });
});

describe('parseWazzupInbound — что по-прежнему отбрасывается', () => {
  it('наше же исходящее с файлом (isEcho) в диалог не попадает', () => {
    const out = parseWazzupInbound({
      messages: [
        {
          messageId: 'w7',
          chatId: '79990001122',
          contentUri: 'https://cdn.local/f/наш-счёт.pdf',
          isEcho: true,
        },
      ],
    });
    expect(out).toEqual([]);
  });

  it('ни текста, ни ссылки на файл → отбрасывается, как и раньше', () => {
    const out = parseWazzupInbound({
      messages: [{ messageId: 'w8', chatId: '79990001122', contentUri: 42 }],
    });
    expect(out).toEqual([]);
  });

  it('сообщение без ссылки остаётся без поля attachment', () => {
    const out = parseWazzupInbound({
      messages: [{ messageId: 'w9', chatId: '79990001122', text: 'просто текст' }],
    });
    expect(out[0]).not.toHaveProperty('attachment');
  });
});
