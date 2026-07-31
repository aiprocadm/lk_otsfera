/**
 * Этап 8 (PR-1) — server-actions реквизитов: маппинг FormData → input,
 * скрытые id, ревалидация, прокидка ошибок с messages.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireSession,
  revalidatePath,
  setOrgRequisites,
  setPartnerRequisites,
  setCompanyRequisites,
  setOrgRequisitesByAdmin,
  setPartnerRequisitesByAdmin,
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  setOrgRequisites: vi.fn(),
  setPartnerRequisites: vi.fn(),
  setCompanyRequisites: vi.fn(),
  setOrgRequisitesByAdmin: vi.fn(),
  setPartnerRequisitesByAdmin: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/organization/requisites', () => ({ setOrgRequisites }));
vi.mock('@/lib/services/partner/requisites', () => ({ setPartnerRequisites }));
vi.mock('@/lib/services/admin/companyRequisites', () => ({ setCompanyRequisites }));
vi.mock('@/lib/services/admin/counterpartyRequisites', () => ({
  setOrgRequisitesByAdmin,
  setPartnerRequisitesByAdmin,
}));

import {
  setOrgRequisitesAction,
  setPartnerRequisitesAction,
  setCompanyRequisitesAction,
  setOrgRequisitesByAdminAction,
  setPartnerRequisitesByAdminAction,
} from '@/server-actions/requisites';

const SESSION = { sub: 'u1', role: 'organization' };

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
});

describe('requisites actions', () => {
  it('org: собирает input (пустые → null), передаёт orgId, ревалидирует', async () => {
    setOrgRequisites.mockResolvedValue({ ok: true });
    const res = await setOrgRequisitesAction(
      form({ orgId: 'org-1', legalName: 'ООО', inn: '7707083893' })
    );
    expect(res).toEqual({ ok: true });
    expect(setOrgRequisites).toHaveBeenCalledWith(
      {},
      SESSION,
      'org-1',
      expect.objectContaining({ legalName: 'ООО', inn: '7707083893', kpp: null, signerBasis: null })
    );
    expect(revalidatePath).toHaveBeenCalledWith('/organization/settings');
  });

  it('org: без orgId → validation; ошибка сервиса с messages пробрасывается', async () => {
    expect(await setOrgRequisitesAction(form({}))).toEqual({ ok: false, error: 'validation' });
    setOrgRequisites.mockResolvedValue({ ok: false, error: 'validation', messages: ['ИНН'] });
    expect(await setOrgRequisitesAction(form({ orgId: 'o' }))).toEqual({
      ok: false,
      error: 'validation',
      messages: ['ИНН'],
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('partner: без скрытых полей; company: companyId + phone/email', async () => {
    setPartnerRequisites.mockResolvedValue({ ok: true });
    expect(await setPartnerRequisitesAction(form({ inn: '7707083893' }))).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/partner/settings');

    setCompanyRequisites.mockResolvedValue({ ok: true });
    await setCompanyRequisitesAction(form({ companyId: 'c1', phone: '+7', email: 'a@b.ru' }));
    expect(setCompanyRequisites).toHaveBeenCalledWith(
      {},
      SESSION,
      'c1',
      expect.objectContaining({ phone: '+7', email: 'a@b.ru' })
    );
    expect(await setCompanyRequisitesAction(form({}))).toEqual({ ok: false, error: 'validation' });
  });

  it('отказ сервиса не ревалидирует страницу ни в одном из вариантов', async () => {
    // Ревалидация — это сброс кэша страницы. Делать его после неудачной записи
    // бессмысленно и вредно: пользователь увидит «обновлённую» страницу со
    // старыми данными и решит, что сохранение прошло.
    setPartnerRequisites.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(await setPartnerRequisitesAction(form({}))).toEqual({ ok: false, error: 'forbidden' });

    setCompanyRequisites.mockResolvedValue({ ok: false, error: 'not_found' });
    expect(await setCompanyRequisitesAction(form({ companyId: 'c1' }))).toEqual({
      ok: false,
      error: 'not_found',
    });

    setOrgRequisitesByAdmin.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(await setOrgRequisitesByAdminAction(form({ orgId: 'o1' }))).toEqual({
      ok: false,
      error: 'forbidden',
    });

    setPartnerRequisitesByAdmin.mockResolvedValue({
      ok: false,
      error: 'validation',
      messages: ['БИК'],
    });
    expect(await setPartnerRequisitesByAdminAction(form({ partnerId: 'p1' }))).toEqual({
      ok: false,
      error: 'validation',
      messages: ['БИК'],
    });

    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('пустые телефон и почта компании превращаются в null, а не в пустые строки', async () => {
    // Пустая строка в базе — это «есть значение, но пустое»; в шапке документов
    // из-за неё появится висящий разделитель. Нужен именно null.
    setCompanyRequisites.mockResolvedValue({ ok: true });
    await setCompanyRequisitesAction(form({ companyId: 'c1', phone: '', email: '' }));
    expect(setCompanyRequisites).toHaveBeenCalledWith(
      {},
      SESSION,
      'c1',
      expect.objectContaining({ phone: null, email: null })
    );
  });

  it('admin-варианты: orgId/partnerId обязательны, ревалидируют карточки', async () => {
    setOrgRequisitesByAdmin.mockResolvedValue({ ok: true });
    await setOrgRequisitesByAdminAction(form({ orgId: 'org-9' }));
    expect(revalidatePath).toHaveBeenCalledWith('/admin/organizations/org-9');

    setPartnerRequisitesByAdmin.mockResolvedValue({ ok: true });
    await setPartnerRequisitesByAdminAction(form({ partnerId: 'pt-9' }));
    expect(revalidatePath).toHaveBeenCalledWith('/admin/partners/pt-9');

    expect(await setOrgRequisitesByAdminAction(form({}))).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(await setPartnerRequisitesByAdminAction(form({}))).toEqual({
      ok: false,
      error: 'validation',
    });
  });
});
