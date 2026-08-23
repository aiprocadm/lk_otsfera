import { describe, expect, it, vi, beforeEach } from 'vitest';

const { suggestParty } = vi.hoisted(() => ({ suggestParty: vi.fn() }));
vi.mock('@/lib/services/dadata/suggestParty', () => ({ suggestParty }));
const { isDadataEnabled } = vi.hoisted(() => ({ isDadataEnabled: vi.fn() }));
vi.mock('@/lib/services/admin/integrations', () => ({ isDadataEnabled }));

import {
  enrichInnByName,
  resetDadataInnCache,
} from '@/lib/services/import/oneCAccountCard/dadata-inn';

const prisma = {} as never;

function suggestion(over: Record<string, unknown> = {}) {
  return {
    name: 'ООО «Ромашка»',
    inn: '7707083893',
    kpp: null,
    ogrn: null,
    address: null,
    status: 'ACTIVE',
    opf: 'ООО',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDadataInnCache();
  isDadataEnabled.mockReturnValue(true);
});

// `У-85`: ИНН из ЕГРЮЛ подставляется только когда сомнений нет — иначе платежи
// уедут к чужой организации, а исправлять это придётся вручную.
describe('enrichInnByName (У-85)', () => {
  it('ровно одна действующая с совпавшим ключом → ИНН принят, источник dadata', async () => {
    suggestParty.mockResolvedValue([suggestion()]);
    const res = await enrichInnByName(prisma, ['РОМАШКА']);
    expect(res.used).toBe(true);
    expect(res.byKey.get('РОМАШКА')).toEqual({
      inn: '7707083893',
      egrulName: 'ООО «Ромашка»',
    });
  });

  it('орг-форма может отличаться: «Ромашка АО» в ЕГРЮЛ подходит ключу «РОМАШКА» (Р-11)', async () => {
    suggestParty.mockResolvedValue([suggestion({ name: 'АО «Ромашка»', opf: 'АО' })]);
    const res = await enrichInnByName(prisma, ['РОМАШКА']);
    expect(res.byKey.get('РОМАШКА')?.inn).toBe('7707083893');
  });

  it('две подсказки с тем же ключом → ИНН не принят (какая из них — неизвестно)', async () => {
    suggestParty.mockResolvedValue([
      suggestion(),
      suggestion({ inn: '7736207543', name: 'ООО «Ромашка»' }),
    ]);
    const res = await enrichInnByName(prisma, ['РОМАШКА']);
    expect(res.byKey.get('РОМАШКА')).toBeUndefined();
  });

  it('ликвидированная организация не даёт ИНН', async () => {
    suggestParty.mockResolvedValue([suggestion({ status: 'LIQUIDATED' })]);
    const res = await enrichInnByName(prisma, ['РОМАШКА']);
    expect(res.byKey.get('РОМАШКА')).toBeUndefined();
  });

  it('ключ не совпал (нашлось похожее, но другое) → ИНН не принят', async () => {
    suggestParty.mockResolvedValue([suggestion({ name: 'ООО «Ромашка-Сервис»' })]);
    const res = await enrichInnByName(prisma, ['РОМАШКА']);
    expect(res.byKey.get('РОМАШКА')).toBeUndefined();
  });

  it('пустой ответ → ИНН не принят, но шаг считается выполненным', async () => {
    suggestParty.mockResolvedValue([]);
    const res = await enrichInnByName(prisma, ['РОМАШКА']);
    expect(res.used).toBe(true);
    expect(res.byKey.size).toBe(0);
  });

  it('DaData выключена → в сеть не ходим, в диагностике причина', async () => {
    isDadataEnabled.mockReturnValue(false);
    const res = await enrichInnByName(prisma, ['РОМАШКА']);
    expect(suggestParty).not.toHaveBeenCalled();
    expect(res).toMatchObject({ used: false, reason: 'disabled' });
  });

  it('сбой DaData не рвёт импорт — шаг помечен как невыполненный', async () => {
    suggestParty.mockRejectedValue(new Error('network'));
    const res = await enrichInnByName(prisma, ['РОМАШКА']);
    expect(res).toMatchObject({ used: false, reason: 'failed' });
    expect(res.byKey.size).toBe(0);
  });

  it('один запрос на контрагента: повтор берётся из кэша', async () => {
    suggestParty.mockResolvedValue([suggestion()]);
    await enrichInnByName(prisma, ['РОМАШКА']);
    await enrichInnByName(prisma, ['РОМАШКА']);
    expect(suggestParty).toHaveBeenCalledTimes(1);
  });

  it('«не нашлось» тоже кэшируется — иначе применение повторит все промахи', async () => {
    suggestParty.mockResolvedValue([]);
    await enrichInnByName(prisma, ['РОМАШКА']);
    await enrichInnByName(prisma, ['РОМАШКА']);
    expect(suggestParty).toHaveBeenCalledTimes(1);
  });

  it('пустой список ключей в сеть не ходит', async () => {
    const res = await enrichInnByName(prisma, []);
    expect(suggestParty).not.toHaveBeenCalled();
    expect(res.used).toBe(false);
  });
});
