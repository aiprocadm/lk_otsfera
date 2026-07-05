// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getLead } = vi.hoisted(() => ({ getLead: vi.fn() }));
vi.mock('@/lib/services/partner/leads', () => ({ getLead }));

const { listLeadAttachments } = vi.hoisted(() => ({ listLeadAttachments: vi.fn() }));
vi.mock('@/lib/services/partner/leadAttachments', () => ({ listLeadAttachments }));

const { isPartnerAdmin } = vi.hoisted(() => ({ isPartnerAdmin: vi.fn() }));
vi.mock('@/lib/auth/policy', () => ({ isPartnerAdmin }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));
vi.mock('next/navigation', () => nav);

import PartnerLeadDetailPage from '@/app/partner/leads/[id]/page';

const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1', assignedOrgIds: ['org-1'] };

const BASE_LEAD = {
  id: 'l1',
  clientCompanyName: 'ООО Клиент',
  clientInn: null,
  clientContactName: 'Иванов И.И.',
  clientContactPhone: null,
  clientContactEmail: null,
  subject: 'Обучение по ОТ',
  status: 'new' as const,
  estimatedAmount: null,
  productType: [] as string[],
  organizationId: null,
  organizationName: null,
  promotedOrderId: null,
  notes: null,
  rejectedReason: null,
  createdByUserName: 'Автор',
  assignedManagerName: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01')
};

describe('PartnerLeadDetailPage', () => {
  beforeEach(() => {
    requirePartner.mockReset();
    getLead.mockReset();
    listLeadAttachments.mockReset();
    isPartnerAdmin.mockReset();
    nav.notFound.mockClear();
  });

  it('calls notFound() when getLead returns null', async () => {
    requirePartner.mockResolvedValue(SESSION);
    getLead.mockResolvedValue(null);

    await expect(
      renderServerComponent(
        PartnerLeadDetailPage({ params: Promise.resolve({ id: 'missing' }) })
      )
    ).rejects.toThrow('NOT_FOUND');

    expect(listLeadAttachments).not.toHaveBeenCalled();
  });

  it('renders a "new" lead with withdraw button, empty attachments fallback (ok:false), and no promoted/rejected banners', async () => {
    requirePartner.mockResolvedValue(SESSION);
    getLead.mockResolvedValue(BASE_LEAD);
    listLeadAttachments.mockResolvedValue({ ok: false, error: 'forbidden' });
    isPartnerAdmin.mockReturnValue(false);

    const { container } = await renderServerComponent(
      PartnerLeadDetailPage({ params: Promise.resolve({ id: 'l1' }) })
    );

    expect(getLead).toHaveBeenCalledWith(
      expect.anything(),
      { leadId: 'l1', partnerId: 'p1', scopeOrgIds: ['org-1'] }
    );
    expect(listLeadAttachments).toHaveBeenCalledWith(
      expect.anything(),
      { leadId: 'l1', partnerId: 'p1', scopeOrgIds: ['org-1'] }
    );
    expect(container.textContent).toContain('ООО Клиент');
    expect(container.textContent).not.toContain('Заявка стала заказом');
    expect(container.textContent).not.toContain('Причина отклонения');
  });

  it('renders a promoted lead with an order link and organization link, no scope when assignedOrgIds is empty', async () => {
    requirePartner.mockResolvedValue({ ...SESSION, assignedOrgIds: [] });
    getLead.mockResolvedValue({
      ...BASE_LEAD,
      status: 'promoted_to_order' as const,
      promotedOrderId: 'order-1',
      organizationId: 'org-1',
      organizationName: 'ООО Ромашка',
      clientInn: '123456',
      clientContactPhone: '+7 999 000-00-00',
      clientContactEmail: 'a@b.com',
      estimatedAmount: '5000.00',
      productType: ['training', 'unknown_type'],
      notes: 'Комментарий тут',
      assignedManagerName: 'Менеджер М.',
      updatedAt: new Date('2024-02-01')
    });
    listLeadAttachments.mockResolvedValue({
      ok: true,
      rows: [
        {
          id: 'a1',
          name: 'file.pdf',
          size: 100,
          mimeType: 'application/pdf',
          createdAt: new Date('2024-01-05'),
          createdByUserId: 'u1',
          createdByUserName: 'Автор'
        }
      ]
    });
    isPartnerAdmin.mockReturnValue(true);

    const { container } = await renderServerComponent(
      PartnerLeadDetailPage({ params: Promise.resolve({ id: 'l1' }) })
    );

    expect(getLead).toHaveBeenCalledWith(
      expect.anything(),
      { leadId: 'l1', partnerId: 'p1', scopeOrgIds: undefined }
    );
    expect(container.textContent).toContain('Заявка стала заказом');
    expect(container.textContent).toContain('ООО Ромашка');
    expect(container.textContent).toContain('Обучение');
    expect(container.textContent).toContain('unknown_type');
    expect(container.textContent).toContain('Комментарий тут');
    expect(container.textContent).toContain('Менеджер М.');

    const orderLink = container.querySelector('a[href="/partner/deals/order-1"]');
    expect(orderLink).not.toBeNull();
  });

  it('renders a rejected lead with the rejection reason banner and no withdraw button, and hides "updated" when equal to createdAt', async () => {
    requirePartner.mockResolvedValue(SESSION);
    getLead.mockResolvedValue({
      ...BASE_LEAD,
      status: 'rejected' as const,
      rejectedReason: 'Не подходит по бюджету'
    });
    listLeadAttachments.mockResolvedValue({ ok: true, rows: [] });
    isPartnerAdmin.mockReturnValue(false);

    const { container } = await renderServerComponent(
      PartnerLeadDetailPage({ params: Promise.resolve({ id: 'l1' }) })
    );

    expect(container.textContent).toContain('Причина отклонения');
    expect(container.textContent).toContain('Не подходит по бюджету');
    expect(container.textContent).not.toContain('Изменена');
  });
});
