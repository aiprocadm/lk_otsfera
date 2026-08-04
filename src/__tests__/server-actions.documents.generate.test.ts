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
  requestRequisites,
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  isFeatureEnabled: vi.fn(),
  generateOrderDocument: vi.fn(),
  requestRequisites: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));
vi.mock('@/lib/services/documents/generate', () => ({ generateOrderDocument }));
vi.mock('@/lib/services/documents/requestRequisites', () => ({ requestRequisites }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { prisma } from '@/lib/db/prisma';
import {
  generateOrderDocumentAction,
  requestRequisitesAction,
} from '@/server-actions/documents/generate';

const SESSION = { sub: 'm1', role: 'manager', companyId: 'co-A' };

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockReturnValue(true);
  requireSession.mockResolvedValue(SESSION);
  requestRequisites.mockResolvedValue({ ok: true });
});

describe('generateOrderDocumentAction', () => {
  it('флаг выключен → forbidden без вызова сервиса', async () => {
    isFeatureEnabled.mockReturnValue(false);
    expect(await generateOrderDocumentAction(form({ orderId: 'o', docType: 'invoice' }))).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(generateOrderDocument).not.toHaveBeenCalled();
  });

  it('мусорный вход → not_found; успех ревалидирует деталку', async () => {
    expect(await generateOrderDocumentAction(form({ docType: 'invoice' }))).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await generateOrderDocumentAction(form({ orderId: 'o', docType: 'bogus' }))).toEqual({
      ok: false,
      error: 'not_found',
    });

    generateOrderDocument.mockResolvedValue({ ok: true, documentId: 'd1', number: 'С-2026-1' });
    const res = await generateOrderDocumentAction(form({ orderId: 'ord-1', docType: 'invoice' }));
    expect(res).toEqual({ ok: true, documentId: 'd1', number: 'С-2026-1' });
    expect(generateOrderDocument).toHaveBeenCalledWith(expect.anything(), SESSION, {
      orderId: 'ord-1',
      docType: 'invoice',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/manager/orders/ord-1');
  });

  it('PR-3: типы contract/extra_agreement принимаются', async () => {
    generateOrderDocument.mockResolvedValue({ ok: true, documentId: 'd2', number: 'Д-2026-1' });
    expect(
      await generateOrderDocumentAction(form({ orderId: 'ord-1', docType: 'contract' }))
    ).toEqual({
      ok: true,
      documentId: 'd2',
      number: 'Д-2026-1',
    });
    expect(generateOrderDocument).toHaveBeenCalledWith(expect.anything(), SESSION, {
      orderId: 'ord-1',
      docType: 'contract',
    });

    generateOrderDocument.mockResolvedValue({ ok: true, documentId: 'd3', number: 'ДС-2026-1' });
    await generateOrderDocumentAction(form({ orderId: 'ord-1', docType: 'extra_agreement' }));
    expect(generateOrderDocument).toHaveBeenLastCalledWith(expect.anything(), SESSION, {
      orderId: 'ord-1',
      docType: 'extra_agreement',
    });
  });

  it('ошибка сервиса пробрасывается без ревалидации', async () => {
    generateOrderDocument.mockResolvedValue({ ok: false, error: 'invoice_required' });
    expect(await generateOrderDocumentAction(form({ orderId: 'ord-1', docType: 'act' }))).toEqual({
      ok: false,
      error: 'invoice_required',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// Скоуп, сбор недостающего и уведомление — в
// services.documents.requestRequisites.test.ts; здесь только адаптер.
describe('requestRequisitesAction', () => {
  it('делегирует в сервис после флага, гарда роли и разбора формы', async () => {
    const res = await requestRequisitesAction(form({ orderId: 'ord-1' }));
    expect(res).toEqual({ ok: true });
    expect(requestRequisites).toHaveBeenCalledWith(prisma, SESSION, { orderId: 'ord-1' });
  });

  it('без orderId в форме → not_found, сервис не зовём', async () => {
    expect(await requestRequisitesAction(new FormData())).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(requestRequisites).not.toHaveBeenCalled();
  });

  it('флаг off → forbidden; клиентская роль → forbidden; сервис не зовём', async () => {
    isFeatureEnabled.mockReturnValue(false);
    expect(await requestRequisitesAction(form({ orderId: 'o' }))).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(requireSession).not.toHaveBeenCalled();

    isFeatureEnabled.mockReturnValue(true);
    requireSession.mockResolvedValue({ sub: 'p', role: 'partner' });
    expect(await requestRequisitesAction(form({ orderId: 'o' }))).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(requestRequisites).not.toHaveBeenCalled();
  });

  it('admin проходит гард роли и доходит до сервиса', async () => {
    requireSession.mockResolvedValue({ sub: 'a1', role: 'admin' });
    expect(await requestRequisitesAction(form({ orderId: 'ord-1' }))).toEqual({ ok: true });
    expect(requestRequisites).toHaveBeenCalledTimes(1);
  });

  it('not_found из сервиса прокидывается как есть', async () => {
    requestRequisites.mockResolvedValue({ ok: false, error: 'not_found' });
    expect(await requestRequisitesAction(form({ orderId: 'ord-1' }))).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});
