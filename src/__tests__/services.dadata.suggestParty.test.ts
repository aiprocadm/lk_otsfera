import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getSettingValue, warn } = vi.hoisted(() => ({
  getSettingValue: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/lib/config/integrationSettings', () => ({ getSettingValue }));
vi.mock('@/lib/logging', () => ({ log: { warn } }));

import { suggestParty, normalizeParty } from '@/lib/services/dadata/suggestParty';

const prisma = {} as never;

/** Помощник: getSettingValue отвечает по ключу. */
function settings(map: Record<string, string | null>) {
  getSettingValue.mockImplementation((_p: unknown, key: string) =>
    Promise.resolve(map[key] ?? null)
  );
}

describe('normalizeParty', () => {
  it('не массив suggestions → []', () => {
    expect(normalizeParty(null)).toEqual([]);
    expect(normalizeParty({})).toEqual([]);
    expect(normalizeParty({ suggestions: 'x' })).toEqual([]);
  });

  it('берёт value+inn, тянет kpp/ogrn/address, пропускает без имени/ИНН', () => {
    const body = {
      suggestions: [
        {
          value: 'ООО Ромашка',
          data: { inn: '7701', kpp: '770101001', ogrn: '102', address: { value: 'Москва' } },
        },
        { value: 'Без ИНН', data: { inn: 123 } }, // inn не строка → пропуск
        { data: { inn: '7702' } }, // нет value → пропуск
        { value: 'Мин поля', data: { inn: '7703' } }, // без kpp/ogrn/address → null
      ],
    };
    expect(normalizeParty(body)).toEqual([
      { name: 'ООО Ромашка', inn: '7701', kpp: '770101001', ogrn: '102', address: 'Москва' },
      { name: 'Мин поля', inn: '7703', kpp: null, ogrn: null, address: null },
    ]);
  });

  it('data=null и address=null не роняют', () => {
    expect(normalizeParty({ suggestions: [{ value: 'X', data: null }] })).toEqual([]);
    expect(
      normalizeParty({ suggestions: [{ value: 'X', data: { inn: '1', address: null } }] })
    ).toEqual([{ name: 'X', inn: '1', kpp: null, ogrn: null, address: null }]);
  });
});

describe('suggestParty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('пустой запрос → [] без обращения к настройкам', async () => {
    expect(await suggestParty(prisma, '   ')).toEqual([]);
    expect(getSettingValue).not.toHaveBeenCalled();
  });

  it('выключено → []', async () => {
    settings({ 'dadata.enabled': 'false' });
    expect(await suggestParty(prisma, 'сбер')).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('включено, но нет ключа → []', async () => {
    settings({ 'dadata.enabled': 'true', 'dadata.apiKey': null });
    expect(await suggestParty(prisma, 'сбер')).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('happy path: шлёт Token-заголовок, нормализует ответ', async () => {
    settings({ 'dadata.enabled': '1', 'dadata.apiKey': 'secret-key' });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: [{ value: 'Сбербанк', data: { inn: '7707' } }] }),
    });

    const res = await suggestParty(prisma, ' сбер ');
    expect(res).toEqual([{ name: 'Сбербанк', inn: '7707', kpp: null, ogrn: null, address: null }]);

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('suggestions.dadata.ru');
    expect((init.headers as Record<string, string>).authorization).toBe('Token secret-key');
    expect(JSON.parse(init.body as string)).toEqual({ query: 'сбер', count: 10 });
  });

  it('HTTP не ok → []', async () => {
    settings({ 'dadata.enabled': 'on', 'dadata.apiKey': 'k' });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await suggestParty(prisma, 'сбер')).toEqual([]);
  });

  it('ошибка сети → [] + log.warn', async () => {
    settings({ 'dadata.enabled': 'true', 'dadata.apiKey': 'k' });
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    expect(await suggestParty(prisma, 'сбер')).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('отказ не-Error значением тоже даёт [] и осмысленный текст в логе', async () => {
    // AbortController отвергает промис DOMException-подобным объектом, а не Error.
    // Без String(err) в лог ушло бы `error: undefined`.
    settings({ 'dadata.enabled': 'true', 'dadata.apiKey': 'k' });
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue('The operation was aborted');
    expect(await suggestParty(prisma, 'сбер')).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      '[dadata] suggest party failed — degrading to empty',
      expect.objectContaining({ error: 'The operation was aborted' })
    );
  });
});
