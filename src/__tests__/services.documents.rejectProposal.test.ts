import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { canReadDocument, setDocumentStatus } = vi.hoisted(() => ({
  canReadDocument: vi.fn(),
  setDocumentStatus: vi.fn(),
}));
vi.mock('@/lib/auth/policy', () => ({ canReadDocument }));
vi.mock('@/lib/services/documents/status', () => ({ setDocumentStatus }));

import { rejectProposal } from '@/lib/services/documents/rejectProposal';

/**
 * `У-165` (этап 7) — заказчик отклоняет коммерческое предложение.
 *
 * Главное здесь — не «статус поменялся», а два правила, ради которых действие
 * и заведено отдельно от аннулирования: причина обязательна, и она пишется в
 * СВОИ поля. Свалив отказ клиента и аннулирование сотрудника в одно поле, мы
 * потеряли бы возможность отличить «клиент сказал нет» от «мы ошиблись в
 * бумаге» — а это разные выводы для бизнеса.
 */
const CLIENT = (): SessionPayload =>
  ({ sub: 'u-org', role: 'organization', organizationId: 'org-1' }) as unknown as SessionPayload;

const DOC = {
  id: 'kp-1',
  type: 'commercial_proposal',
  status: 'sent',
  orderId: null,
  companyId: 'co-A',
  counterpartyType: 'organization',
  counterpartyId: 'org-1',
  order: null,
};

function makePrisma(over: Record<string, unknown> | null = {}) {
  const prisma = {
    document: {
      findUnique: vi.fn(async () => (over === null ? null : { ...DOC, ...over })),
    },
  } as unknown as PrismaClient;
  return { prisma };
}

beforeEach(() => {
  vi.clearAllMocks();
  canReadDocument.mockResolvedValue(true);
  setDocumentStatus.mockResolvedValue({ ok: true });
});

describe('rejectProposal — кто и что', () => {
  it('отклоняет ТОЛЬКО заказчик: у сотрудника для этого есть аннулирование', async () => {
    // Смешай их — и в отчёте о причинах отказов клиентов окажутся наши
    // собственные опечатки в бумагах.
    for (const role of ['manager', 'leader', 'admin', 'partner']) {
      const { prisma } = makePrisma();
      expect(
        await rejectProposal(prisma, { sub: 'x', role } as unknown as SessionPayload, {
          documentId: 'kp-1',
          reason: 'дорого',
        }),
        role
      ).toEqual({ ok: false, error: 'forbidden' });
    }
    expect(setDocumentStatus).not.toHaveBeenCalled();
  });

  it('пустая причина — отказ, а не молчаливое сохранение пустоты', async () => {
    // Причина — единственное, ради чего действие существует: «дорого»,
    // «сроки» и «выбрали другого» ведут к разным следующим шагам.
    const { prisma } = makePrisma();
    for (const reason of ['', '   ', '\n\t']) {
      expect(await rejectProposal(prisma, CLIENT(), { documentId: 'kp-1', reason })).toEqual({
        ok: false,
        error: 'reason_required',
      });
    }
    expect(setDocumentStatus).not.toHaveBeenCalled();
  });

  it('причина проверяется ДО похода в базу: пустая не стоит запроса', async () => {
    const { prisma } = makePrisma();
    await rejectProposal(prisma, CLIENT(), { documentId: 'kp-1', reason: '' });
    expect(prisma.document.findUnique).not.toHaveBeenCalled();
  });

  it('не предложение отклонить нельзя: у акта отказ означает другое', async () => {
    const { prisma } = makePrisma({ type: 'act' });
    expect(
      await rejectProposal(prisma, CLIENT(), { documentId: 'kp-1', reason: 'не подходит' })
    ).toEqual({ ok: false, error: 'not_a_proposal' });
  });

  it('чужой документ — «не найдено», существование не подтверждаем', async () => {
    canReadDocument.mockResolvedValue(false);
    const { prisma } = makePrisma();
    expect(
      await rejectProposal(prisma, CLIENT(), { documentId: 'kp-1', reason: 'дорого' })
    ).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('rejectProposal — запись', () => {
  it('идёт через единственную дверь к статусу и несёт причину', async () => {
    const { prisma } = makePrisma();
    expect(
      await rejectProposal(prisma, CLIENT(), { documentId: 'kp-1', reason: '  дорого  ' })
    ).toEqual({ ok: true });
    expect(setDocumentStatus).toHaveBeenCalledWith(prisma, expect.anything(), {
      documentId: 'kp-1',
      to: 'rejected',
      reason: 'дорого',
    });
  });

  it('слишком длинная причина обрезается, а не роняет действие', async () => {
    const { prisma } = makePrisma();
    await rejectProposal(prisma, CLIENT(), { documentId: 'kp-1', reason: 'я'.repeat(5000) });
    const reason = setDocumentStatus.mock.calls[0]![2].reason as string;
    expect(reason.length).toBe(2000);
  });

  it('матрица не пустила — отдаём отказ как есть, а не притворяемся успехом', async () => {
    // Так бывает, если предложение уже приняли или аннулировали.
    setDocumentStatus.mockResolvedValue({ ok: false, error: 'invalid_transition' });
    const { prisma } = makePrisma();
    expect(
      await rejectProposal(prisma, CLIENT(), { documentId: 'kp-1', reason: 'дорого' })
    ).toEqual({ ok: false, error: 'invalid_transition' });
  });
});
