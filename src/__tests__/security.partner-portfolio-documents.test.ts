import { describe, it, expect, vi, beforeEach } from 'vitest';

const { organizationFindUnique, documentFindUnique, organizationFindFirst, orderFindUnique } =
  vi.hoisted(() => ({
    organizationFindUnique: vi.fn(),
    documentFindUnique: vi.fn(),
    organizationFindFirst: vi.fn(),
    orderFindUnique: vi.fn(),
  }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    organization: { findUnique: organizationFindUnique, findFirst: organizationFindFirst },
    document: { findUnique: documentFindUnique },
    order: { findUnique: orderFindUnique },
  },
}));

import { canReadDocument } from '@/lib/auth/policy';
import { partnerPortfolioDocumentsWhere } from '@/lib/auth/documentChannelPolicy';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * `У-155` (дефект `Д-15`, решение `Р-18`) — партнёр видит документы
 * организаций СВОЕГО портфеля и не видит чужие.
 *
 * Это место, где ошибка означает утечку чужих счетов, поэтому проверяем обе
 * стороны: и что своё стало видно, и что чужое по-прежнему закрыто.
 */
const partner = (over: Partial<SessionPayload> = {}): SessionPayload =>
  ({ sub: 'p1', role: 'partner', partnerId: 'partner-1', ...over }) as unknown as SessionPayload;

const orgDocument = {
  id: 'doc-1',
  orderId: 'ord-1',
  companyId: null,
  counterpartyType: 'organization' as const,
  counterpartyId: 'org-A',
  order: { companyId: 'co-1' },
};

beforeEach(() => {
  vi.clearAllMocks();
  // Заказ этой компании ведёт организация партнёра — общий гейт заказа.
  organizationFindFirst.mockResolvedValue({ id: 'org-A' });
});

describe('партнёр и документы организаций портфеля', () => {
  it('организация в портфеле → её счёт партнёр читает', () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'partner-1' });
    return expect(canReadDocument(partner(), orgDocument)).resolves.toBe(true);
  });

  it('организация ЧУЖАЯ → отказ, даже если она в той же компании', async () => {
    // Раньше партнёр не видел таких документов вовсе; открывая доступ, нельзя
    // было открыть его к соседней организации.
    organizationFindUnique.mockResolvedValue({ partnerId: 'partner-2' });
    expect(await canReadDocument(partner(), orgDocument)).toBe(false);
  });

  it('организация в портфеле, но вне назначенного скоупа сотрудника → отказ', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'partner-1' });
    expect(await canReadDocument(partner({ assignedOrgIds: ['org-B'] }), orgDocument)).toBe(false);
  });

  it('свой партнёрский документ читается без похода в портфель', async () => {
    expect(
      await canReadDocument(partner(), {
        ...orgDocument,
        counterpartyType: 'partner',
        counterpartyId: 'partner-1',
      })
    ).toBe(true);
    expect(organizationFindUnique).not.toHaveBeenCalled();
  });

  it('чужой партнёрский канал закрыт', async () => {
    expect(
      await canReadDocument(partner(), {
        ...orgDocument,
        counterpartyType: 'partner',
        counterpartyId: 'partner-9',
      })
    ).toBe(false);
  });
});

describe('выборка вкладки «Документы» карточки организации', () => {
  it('берёт оба канала и прячет заражённые файлы', () => {
    const where = partnerPortfolioDocumentsWhere({ partnerId: 'partner-1', orgId: 'org-A' });
    expect(where.OR).toEqual([
      { counterpartyType: 'partner', counterpartyId: 'partner-1' },
      { counterpartyType: 'organization', counterpartyId: 'org-A' },
    ]);
    // Заражённый файл не должен появляться в списке ни в одном канале.
    expect(JSON.stringify(where)).toContain('scanStatus');
  });
});
