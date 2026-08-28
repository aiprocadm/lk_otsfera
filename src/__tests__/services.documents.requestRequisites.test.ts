/**
 * Unit-тесты сервиса `requestRequisites`
 * (src/lib/services/documents/requestRequisites.ts): mode-aware скоуп менеджера
 * (C8), только org-недостающее в уведомлении, graceful-сбой доставки.
 * Флаг/роль/форма входа — в server-actions.documents.generate.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const {
  notifyOrgUsers,
  orderFindUnique,
  companyFindUnique,
  organizationFindUnique,
  getCompanyTeamVisibility,
  canSeeOrderMock,
} = vi.hoisted(() => ({
  notifyOrgUsers: vi.fn(),
  orderFindUnique: vi.fn(),
  companyFindUnique: vi.fn(),
  organizationFindUnique: vi.fn(),
  getCompanyTeamVisibility: vi.fn(),
  canSeeOrderMock: vi.fn(),
}));

vi.mock('@/lib/notifications', () => ({ notifyOrgUsers }));
vi.mock('@/lib/auth/managerPolicy', () => ({
  getCompanyTeamVisibility,
  canSeeOrder: canSeeOrderMock,
}));
vi.mock('@/lib/logging', () => ({ log: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    order: { findUnique: orderFindUnique },
    company: { findUnique: companyFindUnique },
    organization: { findUnique: organizationFindUnique },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { requestRequisites } from '@/lib/services/documents/requestRequisites';

const SESSION: SessionPayload = { sub: 'm1', role: 'manager', companyId: 'co-A' };
const ORDER = {
  id: 'ord-1',
  title: 'Заказ',
  orderNumber: '1',
  companyId: 'co-A',
  organizationId: 'org-1',
  managerId: 'm1',
};
const FULL = {
  name: 'x',
  legalName: 'x',
  inn: '1',
  kpp: '1',
  legalAddress: 'x',
  bankName: 'x',
  bankAccount: '1',
  corrAccount: '1',
  bic: '1',
  signerName: 'x',
  signerPosition: 'x',
};

beforeEach(() => {
  vi.clearAllMocks();
  orderFindUnique.mockResolvedValue(ORDER);
  companyFindUnique.mockResolvedValue(FULL);
  organizationFindUnique.mockResolvedValue(FULL);
  getCompanyTeamVisibility.mockResolvedValue(false);
  canSeeOrderMock.mockReturnValue(true);
  notifyOrgUsers.mockResolvedValue({});
});

describe('requestRequisites', () => {
  it('шлёт requisites_requested только с org-недостающим', async () => {
    organizationFindUnique.mockResolvedValue({ ...FULL, inn: null, legalAddress: null });
    companyFindUnique.mockResolvedValue({ ...FULL, bic: null }); // company-недостающее не попадает клиенту
    const res = await requestRequisites(prisma, SESSION, { orderId: 'ord-1' });
    expect(res).toEqual({ ok: true });
    const payload = notifyOrgUsers.mock.calls[0]![1];
    expect(payload.type).toBe('requisites_requested');
    // `У-156`: спрашиваем разом всё, что нужно ЛЮБОМУ документу — счёт требует
    // ИНН и адрес, договор ещё и основание полномочий. Дёргать клиента дважды
    // ради одного и того же пакета бумаг незачем.
    expect(payload.payload.missingLabels).toEqual(
      expect.arrayContaining([
        'ИНН заказчика',
        'юр. адрес заказчика',
        'основание полномочий заказчика',
      ])
    );
    // Дыры компании клиенту не показываем — это не его забота.
    expect(payload.payload.missingLabels.join(' ')).not.toContain('исполнителя');
  });

  it('заказ без организации или компании → not_found: запрашивать реквизиты не у кого', async () => {
    // Заказ может быть заведён без клиента (черновик из 1С). Слать уведомление
    // некуда — честный not_found вместо падения на пустом organizationId.
    orderFindUnique.mockResolvedValue({ ...ORDER, organizationId: null });
    expect(await requestRequisites(prisma, SESSION, { orderId: 'ord-1' })).toEqual({
      ok: false,
      error: 'not_found',
    });

    orderFindUnique.mockResolvedValue({ ...ORDER, companyId: null });
    expect(await requestRequisites(prisma, SESSION, { orderId: 'ord-1' })).toEqual({
      ok: false,
      error: 'not_found',
    });

    orderFindUnique.mockResolvedValue(null);
    expect(await requestRequisites(prisma, SESSION, { orderId: 'ord-1' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });

  it('карточка компании или организации исчезла → not_found, а не падение', async () => {
    companyFindUnique.mockResolvedValue(null);
    expect(await requestRequisites(prisma, SESSION, { orderId: 'ord-1' })).toEqual({
      ok: false,
      error: 'not_found',
    });

    companyFindUnique.mockResolvedValue(FULL);
    organizationFindUnique.mockResolvedValue(null);
    expect(await requestRequisites(prisma, SESSION, { orderId: 'ord-1' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });

  it('скоуп менеджера mode-aware: чужой заказ → not_found, teamMode прокинут в canSeeOrder', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    canSeeOrderMock.mockReturnValue(false);

    expect(await requestRequisites(prisma, SESSION, { orderId: 'ord-1' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(getCompanyTeamVisibility).toHaveBeenCalledWith(prisma, 'co-A');
    expect(canSeeOrderMock).toHaveBeenCalledWith(
      SESSION,
      { managerId: 'm1', organizationId: 'org-1', companyId: 'co-A' },
      true
    );
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });

  it('admin проходит без скоуп-проверки менеджера (Model A)', async () => {
    const admin: SessionPayload = { sub: 'a1', role: 'admin' };
    expect(await requestRequisites(prisma, admin, { orderId: 'ord-1' })).toEqual({ ok: true });
    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
    expect(canSeeOrderMock).not.toHaveBeenCalled();
    expect(notifyOrgUsers).toHaveBeenCalledTimes(1);
  });

  it('сбой доставки уведомления не ломает действие (best-effort)', async () => {
    notifyOrgUsers.mockRejectedValue(new Error('down'));
    expect(await requestRequisites(prisma, SESSION, { orderId: 'ord-1' })).toEqual({ ok: true });
  });
});
