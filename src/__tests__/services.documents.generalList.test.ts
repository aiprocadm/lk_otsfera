import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { listGeneralDocuments } from '@/lib/services/documents/generalList';

/**
 * Форма запроса «общих» документов (аудит A1: запрос уехал со страницы
 * /admin/documents в сервис). Проверка аргументов prisma переехала сюда из
 * pages.admin-documents.test.tsx.
 */
function makePrisma(findMany: ReturnType<typeof vi.fn>) {
  return { document: { findMany } } as unknown as PrismaClient;
}

describe('listGeneralDocuments()', () => {
  it('берёт только документы без заказа: свежие сверху, не более 200, узкий select', async () => {
    const findMany = vi.fn().mockResolvedValue([]);

    await listGeneralDocuments(makePrisma(findMany));

    expect(findMany).toHaveBeenCalledWith({
      where: { orderId: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        name: true,
        type: true,
        direction: true,
        signedAt: true,
        createdAt: true,
        size: true,
      },
    });
  });

  it('раскладывает строки в OrgDocumentRow с пустыми полями заказа', async () => {
    const createdAt = new Date('2024-01-01T00:00:00Z');
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'd1',
        name: 'Общий.pdf',
        type: 'report',
        direction: 'incoming',
        signedAt: null,
        createdAt,
        size: 100,
      },
    ]);

    const rows = await listGeneralDocuments(makePrisma(findMany));

    expect(rows).toEqual([
      {
        id: 'd1',
        name: 'Общий.pdf',
        type: 'report',
        direction: 'incoming',
        signedAt: null,
        createdAt,
        size: 100,
        orderId: null,
        orderNumber: null,
        orderTitle: null,
      },
    ]);
  });
});
