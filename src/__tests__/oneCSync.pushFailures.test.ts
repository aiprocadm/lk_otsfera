import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { countFailedDocumentPushes } from '@/lib/services/oneCSync/pushFailures';

/**
 * `У-174` — одна цифра «сколько документов 1С не приняла» на светофор и на
 * оповещение. Проверяем форму запроса: только `failed`, только действующие
 * версии, компания — по желанию вызывающего.
 */
function makePrisma(n = 0) {
  const count = vi.fn().mockResolvedValue(n);
  return { prisma: { document: { count } } as unknown as PrismaClient, count };
}

describe('countFailedDocumentPushes', () => {
  it('по всей платформе: failed и не заменённые перевыпуском', async () => {
    const { prisma, count } = makePrisma(3);
    expect(await countFailedDocumentPushes(prisma)).toBe(3);
    expect(count).toHaveBeenCalledWith({
      where: { oneCPushStatus: 'failed', supersededAt: null },
    });
  });

  it('с компанией — тот же фильтр плюс companyId', async () => {
    const { prisma, count } = makePrisma();
    await countFailedDocumentPushes(prisma, { companyId: 'co-1' });
    expect(count.mock.calls[0][0].where).toEqual({
      oneCPushStatus: 'failed',
      supersededAt: null,
      companyId: 'co-1',
    });
  });

  it('companyId: undefined — ключ в where не появляется (не «companyId = null»)', async () => {
    const { prisma, count } = makePrisma();
    await countFailedDocumentPushes(prisma, { companyId: undefined });
    expect(count.mock.calls[0][0].where).toEqual({ oneCPushStatus: 'failed', supersededAt: null });
  });
});
