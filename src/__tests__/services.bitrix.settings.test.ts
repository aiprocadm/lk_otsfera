import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSettingValues } = vi.hoisted(() => ({ getSettingValues: vi.fn() }));
vi.mock('@/lib/config/integrationSettings', () => ({ getSettingValues }));

import {
  loadBitrixConnection,
  normalizeWebhookUrl,
  portalHost,
} from '@/lib/services/bitrix/settings';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-188`, `У-199`): настройки подключения к Битрикс24.
 * Таблица «пользователь Битрикса → пользователь ЛК» разбирается только через
 * `loadBitrixConnection` — сам разборщик наружу не экспортируется.
 */

const prisma = {} as never;

/** `getSettingValues` отвечает картой «ключ → значение» (нет ключа → нет поля). */
function settings(map: Record<string, string | null>) {
  getSettingValues.mockResolvedValue(map);
}

beforeEach(() => {
  vi.clearAllMocks();
  settings({});
});

describe('loadBitrixConnection — чтение bitrix.* одним запросом', () => {
  it('спрашивает четыре ключа реестра одним вызовом и раскладывает их по полям', async () => {
    settings({
      'bitrix.portalUrl': 'https://demo.bitrix24.ru',
      'bitrix.webhookUrl': 'https://demo.bitrix24.ru/rest/1/abc123/',
      'bitrix.defaultManagerId': 'user-1',
      'bitrix.userMap': '{"1":"user-1","2":"user-2"}',
    });
    const conn = await loadBitrixConnection(prisma);
    expect(getSettingValues).toHaveBeenCalledTimes(1);
    expect(getSettingValues).toHaveBeenCalledWith(prisma, [
      'bitrix.portalUrl',
      'bitrix.webhookUrl',
      'bitrix.defaultManagerId',
      'bitrix.userMap',
    ]);
    expect(conn).toEqual({
      portalUrl: 'https://demo.bitrix24.ru',
      webhookUrl: 'https://demo.bitrix24.ru/rest/1/abc123/',
      defaultManagerId: 'user-1',
      userMap: { '1': 'user-1', '2': 'user-2' },
    });
  });

  it('пустая база → null во всех полях и пустая таблица пользователей', async () => {
    const conn = await loadBitrixConnection(prisma);
    expect(conn).toEqual({
      portalUrl: null,
      webhookUrl: null,
      defaultManagerId: null,
      userMap: {},
    });
  });

  it('явный null в значении тоже даёт null (а не строку «null»)', async () => {
    settings({
      'bitrix.portalUrl': null,
      'bitrix.webhookUrl': null,
      'bitrix.defaultManagerId': null,
      'bitrix.userMap': null,
    });
    const conn = await loadBitrixConnection(prisma);
    expect(conn.portalUrl).toBeNull();
    expect(conn.webhookUrl).toBeNull();
    expect(conn.defaultManagerId).toBeNull();
    expect(conn.userMap).toEqual({});
  });

  describe('таблица пользователей (bitrix.userMap)', () => {
    async function userMapOf(raw: string | null) {
      settings({ 'bitrix.userMap': raw });
      return (await loadBitrixConnection(prisma)).userMap;
    }

    it('пустая строка → пусто', async () => {
      expect(await userMapOf('')).toEqual({});
    });

    it('битый JSON → пусто, а не исключение', async () => {
      expect(await userMapOf('{не json')).toEqual({});
    });

    it('JSON-массив, строка и null — не таблица → пусто', async () => {
      expect(await userMapOf('["1","2"]')).toEqual({});
      expect(await userMapOf('"строка"')).toEqual({});
      expect(await userMapOf('null')).toEqual({});
      expect(await userMapOf('42')).toEqual({});
    });

    it('оставляет только пары «непустая строка → непустая строка»', async () => {
      expect(
        await userMapOf(
          JSON.stringify({ '1': 'user-1', '2': 5, '3': '', '4': null, '': 'без ключа', '5': 'u5' })
        )
      ).toEqual({ '1': 'user-1', '5': 'u5' });
    });
  });
});

describe('portalHost — домен портала для логов и экрана (У-199)', () => {
  it('пусто, null и undefined → пустая строка', () => {
    expect(portalHost('')).toBe('');
    expect(portalHost(null)).toBe('');
    expect(portalHost(undefined)).toBe('');
  });

  it('из URL вебхука с токеном остаётся только домен', () => {
    const host = portalHost('https://demo.bitrix24.ru/rest/1/secret-token/');
    expect(host).toBe('demo.bitrix24.ru');
    expect(host).not.toContain('secret-token');
  });

  it('адрес без схемы и с пробелами по краям тоже даёт домен', () => {
    expect(portalHost('  demo.bitrix24.ru  ')).toBe('demo.bitrix24.ru');
    expect(portalHost('demo.bitrix24.ru/crm/')).toBe('demo.bitrix24.ru');
  });

  it('порт входит в host, как у URL', () => {
    expect(portalHost('http://localhost:8080/rest/1/x/')).toBe('localhost:8080');
  });

  it('кривой адрес → пустая строка, а не исключение', () => {
    expect(portalHost('://')).toBe('');
    expect(portalHost('https://')).toBe('');
  });
});

describe('normalizeWebhookUrl — форма входящего вебхука', () => {
  it('пустая строка и пробелы → не ок', () => {
    expect(normalizeWebhookUrl('')).toEqual({ ok: false });
    expect(normalizeWebhookUrl('   ')).toEqual({ ok: false });
  });

  it('не URL → не ок', () => {
    expect(normalizeWebhookUrl('это не адрес')).toEqual({ ok: false });
  });

  it('только https: http отклоняется', () => {
    expect(normalizeWebhookUrl('http://demo.bitrix24.ru/rest/1/abc123/')).toEqual({ ok: false });
  });

  it('путь не вида /rest/<id>/<token>/ → не ок', () => {
    expect(normalizeWebhookUrl('https://demo.bitrix24.ru/')).toEqual({ ok: false });
    expect(normalizeWebhookUrl('https://demo.bitrix24.ru/rest/abc/def/')).toEqual({ ok: false });
    expect(normalizeWebhookUrl('https://demo.bitrix24.ru/rest/1/')).toEqual({ ok: false });
    expect(normalizeWebhookUrl('https://demo.bitrix24.ru/rest/1/тук-тук/')).toEqual({ ok: false });
  });

  it('канонический адрес возвращается как есть', () => {
    expect(normalizeWebhookUrl('https://demo.bitrix24.ru/rest/1/abc123/')).toEqual({
      ok: true,
      url: 'https://demo.bitrix24.ru/rest/1/abc123/',
    });
  });

  it('без хвостового слэша, с методом, пробелами и query — нормализуется к базе', () => {
    const expected = { ok: true, url: 'https://demo.bitrix24.ru/rest/17/AbC123xyz/' };
    expect(normalizeWebhookUrl('https://demo.bitrix24.ru/rest/17/AbC123xyz')).toEqual(expected);
    expect(normalizeWebhookUrl('https://demo.bitrix24.ru/rest/17/AbC123xyz/profile.json')).toEqual(
      expected
    );
    expect(normalizeWebhookUrl('  https://demo.bitrix24.ru/rest/17/AbC123xyz/?x=1  ')).toEqual(
      expected
    );
  });
});
