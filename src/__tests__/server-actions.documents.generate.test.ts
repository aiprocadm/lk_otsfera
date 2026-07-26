/**
 * Этап 8 (PR-2) — actions генерации: флаг document_generation, валидация входа,
 * прокидка результата; requestRequisites: роль/скоуп, только org-недостающее.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireSession,
  revalidatePath,
  isFeatureEnabled,
  generateOrderDocument,
  notifyOrgUsers,
  orderFindUnique,
  companyFindUnique,
  organizationFindUnique,
  getCompanyTeamVisibility,
  canSeeOrderMock
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  isFeatureEnabled: vi.fn(),
  generateOrderDocument: vi.fn(),
  notifyOrgUsers: vi.fn(),
  orderFindUnique: vi.fn(),
  companyFindUnique: vi.fn(),
  organizationFindUnique: vi.fn(),
  getCompanyTeamVisibility: vi.fn(),
  canSeeOrderMock: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));
vi.mock('@/lib/services/documents/generate', () => ({ generateOrderDocument }));
vi.mock('@/lib/notifications', () => ({ notifyOrgUsers }));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility, canSeeOrder: canSeeOrderMock }));
vi.mock('@/lib/logging', () => ({ log: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    order: { findUnique: orderFindUnique },
    company: { findUnique: companyFindUnique },
    organization: { findUnique: organizationFindUnique }
  }
}));

import { generateOrderDocumentAction, requestRequisitesAction } from '@/server-actions/documents/generate';

const SESSION = { sub: 'm1', role: 'manager', companyId: 'co-A' };
const ORDER = { id: 'ord-1', title: 'Заказ', orderNumber: '1', companyId: 'co-A', organizationId: 'org-1', managerId: 'm1' };
const FULL = {
  name: 'x', legalName: 'x', inn: '1', kpp: '1', legalAddress: 'x', bankName: 'x',
  bankAccount: '1', corrAccount: '1', bic: '1', signerName: 'x', signerPosition: 'x'
};

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockReturnValue(true);
  requireSession.mockResolvedValue(SESSION);
  orderFindUnique.mockResolvedValue(ORDER);
  companyFindUnique.mockResolvedValue(FULL);
  organizationFindUnique.mockResolvedValue(FULL);
  getCompanyTeamVisibility.mockResolvedValue(false);
  canSeeOrderMock.mockReturnValue(true);
  notifyOrgUsers.mockResolvedValue({});
});

describe('generateOrderDocumentAction', () => {
  it('флаг выключен → forbidden без вызова сервиса', async () => {
    isFeatureEnabled.mockReturnValue(false);
    expect(await generateOrderDocumentAction(form({ orderId: 'o', docType: 'invoice' }))).toEqual({ ok: false, error: 'forbidden' });
    expect(generateOrderDocument).not.toHaveBeenCalled();
  });

  it('мусорный вход → not_found; успех ревалидирует деталку', async () => {
    expect(await generateOrderDocumentAction(form({ docType: 'invoice' }))).toEqual({ ok: false, error: 'not_found' });
    expect(await generateOrderDocumentAction(form({ orderId: 'o', docType: 'contract' }))).toEqual({ ok: false, error: 'not_found' });

    generateOrderDocument.mockResolvedValue({ ok: true, documentId: 'd1', number: 'С-2026-1' });
    const res = await generateOrderDocumentAction(form({ orderId: 'ord-1', docType: 'invoice' }));
    expect(res).toEqual({ ok: true, documentId: 'd1', number: 'С-2026-1' });
    expect(generateOrderDocument).toHaveBeenCalledWith(expect.anything(), SESSION, { orderId: 'ord-1', docType: 'invoice' });
    expect(revalidatePath).toHaveBeenCalledWith('/manager/orders/ord-1');
  });

  it('ошибка сервиса пробрасывается без ревалидации', async () => {
    generateOrderDocument.mockResolvedValue({ ok: false, error: 'invoice_required' });
    expect(await generateOrderDocumentAction(form({ orderId: 'ord-1', docType: 'act' }))).toEqual({ ok: false, error: 'invoice_required' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('requestRequisitesAction', () => {
  it('шлёт requisites_requested только с org-недостающим', async () => {
    organizationFindUnique.mockResolvedValue({ ...FULL, inn: null, legalAddress: null });
    companyFindUnique.mockResolvedValue({ ...FULL, bic: null }); // company-недостающее не попадает клиенту
    const res = await requestRequisitesAction(form({ orderId: 'ord-1' }));
    expect(res).toEqual({ ok: true });
    const payload = notifyOrgUsers.mock.calls[0]![1];
    expect(payload.type).toBe('requisites_requested');
    expect(payload.payload.missingLabels).toEqual(['ИНН заказчика', 'юр. адрес заказчика']);
  });

  it('флаг/роль/скоуп: off → forbidden; клиент → forbidden; чужой заказ → not_found; сбой notify не ломает', async () => {
    isFeatureEnabled.mockReturnValue(false);
    expect(await requestRequisitesAction(form({ orderId: 'o' }))).toEqual({ ok: false, error: 'forbidden' });

    isFeatureEnabled.mockReturnValue(true);
    requireSession.mockResolvedValue({ sub: 'p', role: 'partner' });
    expect(await requestRequisitesAction(form({ orderId: 'o' }))).toEqual({ ok: false, error: 'forbidden' });

    requireSession.mockResolvedValue(SESSION);
    canSeeOrderMock.mockReturnValue(false);
    expect(await requestRequisitesAction(form({ orderId: 'ord-1' }))).toEqual({ ok: false, error: 'not_found' });

    canSeeOrderMock.mockReturnValue(true);
    notifyOrgUsers.mockRejectedValue(new Error('down'));
    expect(await requestRequisitesAction(form({ orderId: 'ord-1' }))).toEqual({ ok: true });
  });
});
