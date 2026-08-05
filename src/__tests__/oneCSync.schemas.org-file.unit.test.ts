import { describe, it, expect } from 'vitest';
import { OneCOrgFileSchema, OneCOrgSchema } from '@/lib/services/oneCSync/schemas';

/**
 * Файловая схема контрагента (Т-21): без валидного ИНН строка не становится
 * организацией — коды no_inn/bad_inn уходят в таблицу ошибок через штатный
 * канал parseRecords (текст первой Zod-issue). Сетевая схема не тронута.
 */
const BASE = {
  externalId: '1c-inn:7707083893',
  name: 'ООО Ромашка',
  updatedAt: '2026-08-05T00:00:00Z',
};

describe('OneCOrgFileSchema', () => {
  it('валидный ИНН проходит', () => {
    const res = OneCOrgFileSchema.safeParse({ ...BASE, inn: '7707083893' });
    expect(res.success).toBe(true);
  });

  it('без ИНН → no_inn', () => {
    const res = OneCOrgFileSchema.safeParse({ ...BASE, externalId: 'ООО Ромашка' });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.message).toBe('no_inn');
  });

  it('битая контрольная сумма → bad_inn', () => {
    const res = OneCOrgFileSchema.safeParse({ ...BASE, inn: '7707083894' });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.message).toBe('bad_inn');
  });

  it('сетевая схема (adapter-rest) контрольную сумму НЕ проверяет — поведение обмена не меняли', () => {
    expect(OneCOrgSchema.safeParse({ ...BASE, inn: '7707083894' }).success).toBe(true);
    expect(OneCOrgSchema.safeParse(BASE).success).toBe(true);
  });
});
