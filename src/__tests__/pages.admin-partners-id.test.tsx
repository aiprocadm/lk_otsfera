// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import EditPartnerPage from '@/app/admin/partners/[id]/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
// §11 ТЗ v0.5 (этап 1 PR-3): страница подтягивает настраиваемые поля — мокаем
// сервис, иначе он полезет в реальный prisma. Обычная функция, а не vi.fn:
// в файле есть resetAllMocks, он снёс бы заготовленный ответ.
vi.mock('@/lib/services/customFields', () => ({
  getFieldsForEntity: async () => []
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

// Этап 8 (PR-1): реквизиты для документов — сервис и карточка стабятся.
const { getOrgRequisitesByAdmin, getPartnerRequisitesByAdmin } = vi.hoisted(() => ({
  getOrgRequisitesByAdmin: vi.fn().mockResolvedValue(null),
  getPartnerRequisitesByAdmin: vi.fn().mockResolvedValue(null)
}));
vi.mock('@/lib/services/admin/counterpartyRequisites', () => ({ getOrgRequisitesByAdmin, getPartnerRequisitesByAdmin }));
vi.mock('@/server-actions/requisites', () => ({
  setOrgRequisitesByAdminAction: vi.fn(),
  setPartnerRequisitesByAdminAction: vi.fn()
}));
vi.mock('@/components/requisites/requisites-card', () => ({
  RequisitesCard: (props: { title: string }) => React.createElement('div', { 'data-testid': 'requisites-card' }, props.title)
}));

const { getPartner } = vi.hoisted(() => ({ getPartner: vi.fn() }));
vi.mock('@/lib/services/admin/partners', () => ({ getPartner }));

const { listRateHistory } = vi.hoisted(() => ({ listRateHistory: vi.fn() }));
vi.mock('@/lib/services/commission/rateHistory', () => ({ listRateHistory }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/admin/partner-edit-form', () => ({
  PartnerEditForm: (props: { partner: unknown }) =>
    React.createElement('div', { 'data-testid': 'partner-edit-form' }, JSON.stringify(props.partner))
}));


const SESSION = { sub: 'admin1', role: 'admin' as const };

const PARTNER = {
  id: 'p1',
  name: 'Партнёр 1',
  slug: 'partner-1',
  admins: [
    { partnerUserId: 'pu1', userId: 'u1', email: 'a@x.com', name: 'Admin', isActive: true, createdAt: new Date('2024-01-01') }
  ]
};

describe('EditPartnerPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    getPartner.mockReset();
    listRateHistory.mockReset();
    nav.notFound.mockClear();
  });

  it('calls notFound() when partner is missing', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getPartner.mockResolvedValue(null);
    listRateHistory.mockResolvedValue({ ok: true, rows: [] });

    await expect(
      renderServerComponent(EditPartnerPage({ params: Promise.resolve({ id: 'missing' }) }))
    ).rejects.toThrow('NOT_FOUND');
  });

  it('карточка реквизитов появляется, когда они заведены', async () => {
    // Админ правит реквизиты партнёра для автогенерации документов. Если бы
    // карточка не отрисовалась, поправить их было бы негде — а без реквизитов
    // договор и счёт не собираются.
    requireAdmin.mockResolvedValue(SESSION);
    getPartner.mockResolvedValue(PARTNER);
    listRateHistory.mockResolvedValue({ ok: true, rows: [] });
    getPartnerRequisitesByAdmin.mockResolvedValue({
      legalName: 'ООО Партнёр',
      inn: '7707083893',
      kpp: null,
      ogrn: null,
      legalAddress: null,
      bankName: null,
      bankAccount: null,
      corrAccount: null,
      bic: null,
      signerName: null,
      signerPosition: null,
      signerBasis: null
    });

    const { container } = await renderServerComponent(
      EditPartnerPage({ params: Promise.resolve({ id: 'p1' }) })
    );

    expect(container.querySelector('[data-testid="requisites-card"]')?.textContent).toContain(
      'Реквизиты для документов'
    );
  });

  it('renders partner details, rate history rows (with oldRate set), and admins table', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getPartner.mockResolvedValue(PARTNER);
    listRateHistory.mockResolvedValue({
      ok: true,
      rows: [
        {
          id: 'r1',
          effectiveFrom: new Date('2024-01-01'),
          oldRate: 0.05,
          newRate: 0.1,
          changedByName: 'Admin'
        }
      ]
    });

    const { container } = await renderServerComponent(
      EditPartnerPage({ params: Promise.resolve({ id: 'p1' }) })
    );

    expect(getPartner).toHaveBeenCalledWith({}, 'p1');
    expect(listRateHistory).toHaveBeenCalledWith({}, SESSION, 'p1');
    expect(container.textContent).toContain('Партнёр 1');
    expect(container.textContent).toContain('partner-1');
    expect(container.textContent).toMatch(/5\s*%/);
    expect(container.textContent).toMatch(/10\s*%/);
    expect(container.textContent).toContain('a@x.com');
    expect(container.textContent).toContain('Да');
    const link = container.querySelector('a[href="/admin/users/u1"]');
    expect(link).not.toBeNull();
  });

  it('falls back rateHistory to [] when ok:false, renders "—" for null oldRate, empty state texts, and isActive:false', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getPartner.mockResolvedValue({
      ...PARTNER,
      admins: [
        { partnerUserId: 'pu2', userId: 'u2', email: 'b@x.com', name: 'Admin2', isActive: false, createdAt: new Date('2024-02-01') }
      ]
    });
    listRateHistory.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(
      EditPartnerPage({ params: Promise.resolve({ id: 'p1' }) })
    );

    expect(container.textContent).toContain('История изменений ставки отсутствует');
    expect(container.textContent).toContain('Нет');
  });

  it('renders "—" for a rate-history row with oldRate:null', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getPartner.mockResolvedValue(PARTNER);
    listRateHistory.mockResolvedValue({
      ok: true,
      rows: [
        {
          id: 'r2',
          effectiveFrom: new Date('2024-03-01'),
          oldRate: null,
          newRate: 0.08,
          changedByName: null
        }
      ]
    });

    const { container } = await renderServerComponent(
      EditPartnerPage({ params: Promise.resolve({ id: 'p1' }) })
    );

    expect(container.textContent).toContain('—');
  });

  it('renders "Нет администраторов" when the admins array is empty', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getPartner.mockResolvedValue({ ...PARTNER, admins: [] });
    listRateHistory.mockResolvedValue({ ok: true, rows: [] });

    const { container } = await renderServerComponent(
      EditPartnerPage({ params: Promise.resolve({ id: 'p1' }) })
    );

    expect(container.textContent).toContain('Нет администраторов');
  });
});
