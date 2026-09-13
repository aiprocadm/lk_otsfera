import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSettingValues } = vi.hoisted(() => ({ getSettingValues: vi.fn() }));
vi.mock('@/lib/config/integrationSettings', () => ({ getSettingValues }));

import { FakeBitrixSource } from '@/lib/services/bitrix/adapter-fake';
import { RestBitrixSource } from '@/lib/services/bitrix/adapter-rest';
import { getBitrixSource } from '@/lib/services/bitrix/factory';
import { BitrixSourceError } from '@/lib/services/bitrix/source';

/**
 * Этап 2 ТЗ 12.09.2026 (`Р-Б-1`): фабрика источника. Порядок решений —
 * `file` → ещё не готов; `FAKE_BITRIX=1` → фикстура (без похода в базу);
 * иначе REST по вебхуку из настроек, а без вебхука — `not_configured`.
 */

const prisma = {} as never;
const WEBHOOK = 'https://demo.bitrix24.ru/rest/1/secret-token/';

const envBefore = process.env.FAKE_BITRIX;

beforeEach(() => {
  vi.clearAllMocks();
  getSettingValues.mockResolvedValue({});
  delete process.env.FAKE_BITRIX;
});

afterEach(() => {
  if (envBefore === undefined) delete process.env.FAKE_BITRIX;
  else process.env.FAKE_BITRIX = envBefore;
});

/** Ловим отказ фабрики и отдаём ошибку источника для проверки кода. */
async function rejection(source: string): Promise<BitrixSourceError> {
  try {
    await getBitrixSource(prisma, { source });
  } catch (err) {
    expect(err).toBeInstanceOf(BitrixSourceError);
    return err as BitrixSourceError;
  }
  throw new Error('фабрика должна была отказать');
}

describe('getBitrixSource — выбор источника', () => {
  it('file → source_not_ready, настройки не читаются (появится в PR-2)', async () => {
    const err = await rejection('file');
    expect(err.code).toBe('source_not_ready');
    expect(err.name).toBe('BitrixSourceError');
    expect(err.message).toContain('Файловый источник');
    expect(getSettingValues).not.toHaveBeenCalled();
  });

  it('file имеет приоритет даже при FAKE_BITRIX=1', async () => {
    process.env.FAKE_BITRIX = '1';
    expect((await rejection('file')).code).toBe('source_not_ready');
  });

  it('FAKE_BITRIX=1 → фикстура, база не спрашивается', async () => {
    process.env.FAKE_BITRIX = '1';
    const source = await getBitrixSource(prisma, { source: 'rest' });
    expect(source).toBeInstanceOf(FakeBitrixSource);
    expect(getSettingValues).not.toHaveBeenCalled();
  });

  it('FAKE_BITRIX с другим значением (0, true, пусто) фикстуру не включает', async () => {
    for (const value of ['0', 'true', '']) {
      process.env.FAKE_BITRIX = value;
      const err = await rejection('rest');
      expect(err.code).toBe('not_configured');
    }
  });

  it('без вебхука → not_configured с понятным текстом без URL', async () => {
    getSettingValues.mockResolvedValue({ 'bitrix.portalUrl': 'https://demo.bitrix24.ru' });
    const err = await rejection('rest');
    expect(err.code).toBe('not_configured');
    expect(err.message).toBe('Не задан входящий вебхук Битрикс24');
    expect(getSettingValues).toHaveBeenCalledWith(
      prisma,
      expect.arrayContaining(['bitrix.webhookUrl'])
    );
  });

  it('с вебхуком → REST-источник; домен портала без токена', async () => {
    getSettingValues.mockResolvedValue({ 'bitrix.webhookUrl': WEBHOOK });
    const source = await getBitrixSource(prisma, { source: 'rest' });
    expect(source).toBeInstanceOf(RestBitrixSource);
    // Единственное, что источник знает о вебхуке наружу, — домен (У-199).
    expect((source as any).host).toBe('demo.bitrix24.ru');
    expect(JSON.stringify((source as any).host)).not.toContain('secret-token');
  });

  it('неизвестный source (не file) трактуется как rest', async () => {
    getSettingValues.mockResolvedValue({ 'bitrix.webhookUrl': WEBHOOK });
    const source = await getBitrixSource(prisma, { source: 'что-то' });
    expect(source).toBeInstanceOf(RestBitrixSource);
  });
});
