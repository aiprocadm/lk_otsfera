// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getPartnerOrderDetail } = vi.hoisted(() => ({ getPartnerOrderDetail: vi.fn() }));
vi.mock('@/lib/services/partner/orderDetail', () => ({ getPartnerOrderDetail }));

const { canPartnerAccessOrg } = vi.hoisted(() => ({ canPartnerAccessOrg: vi.fn() }));
vi.mock('@/lib/auth/policy', () => ({ canPartnerAccessOrg }));

const { getValuesForEntity } = vi.hoisted(() => ({ getValuesForEntity: vi.fn() }));
vi.mock('@/lib/services/customFields', () => ({ getValuesForEntity }));

const nav = vi.hoisted(() => ({
  // `У-232`: notFound() карточка больше не зовёт — удалённый и чужой заказ
  // одинаково уводят в список раздела с `?missing=1`.
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

// order-items-section and order-custom-fields are 'use client' components that
// call useRouter() -- stub next/navigation above covers that.

import PartnerDealDetailPage from '@/app/partner/orders/[id]/page';

const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1', assignedOrgIds: ['org-1'] };

const BASE_DEAL = {
  id: 'deal-1',
  orderNumber: '2024-001',
  title: 'Обучение по ОТ',
  stage: 'in_progress' as const,
  executionStatus: 'in_progress' as const,
  financialStatus: 'not_billed' as const,
  totalAmount: '1000.00',
  paidAmount: '0.00',
  debt: '1000.00',
  vatIncluded: false,
  vatRate: null,
  productMix: [],
  createdAt: new Date('2024-01-01'),
  deadline: null,
  contractSignedAt: null,
  completedAt: null,
  closedAt: null,
  paidAt: null,
  lastSyncedAt: null,
  organization: null,
  managerName: 'Менеджер М.',
  documents: [],
  comments: [],
  items: [],
};

describe('PartnerDealDetailPage', () => {
  beforeEach(() => {
    requirePartner.mockReset();
    getPartnerOrderDetail.mockReset();
    canPartnerAccessOrg.mockReset();
    getValuesForEntity.mockReset();
    nav.redirect.mockClear();
  });

  // `У-232` (спека §3.7): удалённый или чужой заказ — не 404, а список раздела
  // с плашкой «объект недоступен».
  it('удалённый или чужой заказ → редирект в список с ?missing=1, а не 404', async () => {
    requirePartner.mockResolvedValue(SESSION);
    getPartnerOrderDetail.mockResolvedValue(null);

    await expect(
      renderServerComponent(PartnerDealDetailPage({ params: Promise.resolve({ id: 'missing' }) }))
    ).rejects.toThrow('REDIRECT:/partner/orders?missing=1');

    expect(canPartnerAccessOrg).not.toHaveBeenCalled();
  });

  // Раньше здесь был редирект на /forbidden — отдельный ответ выдавал, что
  // заказ существует. Теперь «нет доступа» отвечает так же, как «не существует».
  it('организация заказа закрыта для партнёра → тот же редирект, что и для удалённого', async () => {
    requirePartner.mockResolvedValue(SESSION);
    getPartnerOrderDetail.mockResolvedValue({
      ...BASE_DEAL,
      organization: { id: 'org-1', name: 'ООО Ромашка', inn: '123' },
    });
    getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });
    canPartnerAccessOrg.mockResolvedValue(false);

    await expect(
      renderServerComponent(PartnerDealDetailPage({ params: Promise.resolve({ id: 'deal-1' }) }))
    ).rejects.toThrow('REDIRECT:/partner/orders?missing=1');

    expect(canPartnerAccessOrg).toHaveBeenCalledWith(SESSION, 'org-1');
  });

  it('renders the full deal detail with custom fields when organization is null (no access re-check)', async () => {
    requirePartner.mockResolvedValue(SESSION);
    getPartnerOrderDetail.mockResolvedValue({
      ...BASE_DEAL,
      documents: [
        {
          id: 'd1',
          name: 'Договор.pdf',
          type: 'contract' as const,
          direction: 'incoming' as const,
          signedAt: null,
          createdAt: new Date('2024-01-02'),
          size: 1024,
          orderId: 'deal-1',
          orderNumber: '2024-001',
          orderTitle: 'Обучение по ОТ',
        },
      ],
    });
    getValuesForEntity.mockResolvedValue({
      ok: true,
      fields: [
        {
          definition: {
            id: 'f1',
            key: 'k1',
            label: 'Поле',
            fieldType: 'text',
            options: null,
            required: false,
            sortOrder: 0,
          },
          value: 'значение',
        },
      ],
    });

    const { container } = await renderServerComponent(
      PartnerDealDetailPage({ params: Promise.resolve({ id: 'deal-1' }) })
    );

    expect(canPartnerAccessOrg).not.toHaveBeenCalled();
    expect(getValuesForEntity).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(), // сессия: этап 1 ТЗ v0.5 фильтрует поля по ролям на сервере
      'order',
      'deal-1'
    );
    // `У-72`: путь «Заказы → Заказ №…» вместо ссылки «Все заказы».
    expect(container.querySelector('nav a[href="/partner/orders"]')).not.toBeNull();
    expect(container.textContent).toContain('Документы');
    expect(container.textContent).toContain('(1)');
  });

  it('allows access and renders when canPartnerAccessOrg grants access with a present organization', async () => {
    requirePartner.mockResolvedValue(SESSION);
    getPartnerOrderDetail.mockResolvedValue({
      ...BASE_DEAL,
      organization: { id: 'org-1', name: 'ООО Ромашка', inn: '123' },
    });
    getValuesForEntity.mockResolvedValue({ ok: false, error: 'not_found' });
    canPartnerAccessOrg.mockResolvedValue(true);

    const { container } = await renderServerComponent(
      PartnerDealDetailPage({ params: Promise.resolve({ id: 'deal-1' }) })
    );

    expect(container.textContent).toContain('Обучение по ОТ');
    // Documents heading with no count badge when there are zero documents.
    expect(container.textContent).not.toContain('Документы (0)');
  });

  it('пока номера заказа нет, в крошке стоит название сделки (У-72)', async () => {
    // Номер приходит из 1С не сразу: до этого сделку надо как-то называть.
    requirePartner.mockResolvedValue(SESSION);
    getPartnerOrderDetail.mockResolvedValue({ ...BASE_DEAL, orderNumber: null });
    getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });
    canPartnerAccessOrg.mockResolvedValue(true);

    const { container } = await renderServerComponent(
      PartnerDealDetailPage({ params: Promise.resolve({ id: 'deal-1' }) })
    );

    expect(container.textContent).toContain('Обучение по ОТ');
    expect(container.textContent).not.toContain('№null');
  });
});
