/**
 * Unit-тесты src/lib/services/documents/generationPanel.ts — читающая половина
 * панели генерации счёта/акта (аудит A1: три запроса уехали с карточки заказа
 * менеджера в сервис). Пиннится форма запросов + обе ветки списка недостающих
 * реквизитов.
 */
import { describe, it, expect, vi } from 'vitest';
import { getDocumentGenerationPanel } from '@/lib/services/documents/generationPanel';

const FULL = {
  name: 'Раб',
  legalName: 'ООО',
  inn: '7707083893',
  kpp: null,
  legalAddress: 'адрес',
  bankName: 'Банк',
  bankAccount: '40702810400000000001',
  corrAccount: '301',
  bic: '044525225',
  signerName: 'Иванов',
  signerPosition: 'Директор',
};

function fakePrisma(opts: {
  company: unknown;
  organization: unknown;
  generated: { type: string }[];
}) {
  return {
    prisma: {
      company: { findUnique: vi.fn().mockResolvedValue(opts.company) },
      organization: { findUnique: vi.fn().mockResolvedValue(opts.organization) },
      document: { groupBy: vi.fn().mockResolvedValue(opts.generated) },
    },
  };
}

const ARGS = { orderId: 'order-1', companyId: 'co-1', organizationId: 'org-1' };

describe('getDocumentGenerationPanel', () => {
  it('обе стороны заполнены: недостающего нет, флаги «уже сгенерировано» по типам', async () => {
    const { prisma } = fakePrisma({
      company: FULL,
      organization: FULL,
      generated: [{ type: 'invoice' }],
    });

    const panel = await getDocumentGenerationPanel(prisma as never, ARGS);

    expect(panel).toEqual({ missing: [], hasInvoice: true, hasContract: false });
    expect(prisma.company.findUnique).toHaveBeenCalledWith({
      where: { id: 'co-1' },
      select: expect.objectContaining({ legalName: true, signerPosition: true }),
    });
    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      select: expect.objectContaining({ inn: true, legalAddress: true }),
    });
    expect(prisma.document.groupBy).toHaveBeenCalledWith({
      by: ['type'],
      where: {
        orderId: 'order-1',
        type: { in: ['invoice', 'contract'] },
        generatedBy: 'system',
      },
      _count: { _all: true },
    });
  });

  it('оба типа уже сгенерированы → обе кнопки помечены как повторные', async () => {
    const { prisma } = fakePrisma({
      company: FULL,
      organization: FULL,
      generated: [{ type: 'invoice' }, { type: 'contract' }],
    });

    const panel = await getDocumentGenerationPanel(prisma as never, ARGS);

    expect(panel.hasInvoice).toBe(true);
    expect(panel.hasContract).toBe(true);
  });

  it('пустые реквизиты заказчика попадают в список недостающего', async () => {
    const { prisma } = fakePrisma({
      company: FULL,
      organization: { ...FULL, inn: null, legalAddress: '   ' },
      generated: [],
    });

    const panel = await getDocumentGenerationPanel(prisma as never, ARGS);

    expect(panel.missing.map((m) => m.label)).toEqual(['ИНН заказчика', 'юр. адрес заказчика']);
    expect(panel.missing.every((m) => m.side === 'organization')).toBe(true);
  });

  it('сторона исчезла между запросами → список недостающего пуст, панель всё равно собирается', async () => {
    const { prisma } = fakePrisma({ company: null, organization: FULL, generated: [] });

    const panel = await getDocumentGenerationPanel(prisma as never, ARGS);

    expect(panel).toEqual({ missing: [], hasInvoice: false, hasContract: false });
  });
});
