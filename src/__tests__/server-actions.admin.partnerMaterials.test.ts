import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  requireSettingsSection,
  revalidatePath,
  updateMaterial,
  publishMaterial,
  unpublishMaterial,
} = vi.hoisted(() => ({
  requireSettingsSection: vi.fn(),
  revalidatePath: vi.fn(),
  updateMaterial: vi.fn(),
  publishMaterial: vi.fn(),
  unpublishMaterial: vi.fn(),
}));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/services/partnerMaterials/hub', () => ({
  updateMaterial,
  publishMaterial,
  unpublishMaterial,
}));

import {
  publishPartnerMaterialAction,
  unpublishPartnerMaterialAction,
  updatePartnerMaterialAction,
} from '@/server-actions/admin/partnerMaterials';

/** Действия хаба «Материалы для партнёров» (`У-237`): гард раздела в каждом, файлы — не здесь. */
const session = { sub: 'l1', role: 'leader', companyId: 'c1' };

function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSettingsSection.mockResolvedValue(session);
  updateMaterial.mockResolvedValue({ ok: true });
  publishMaterial.mockResolvedValue({ ok: true });
  unpublishMaterial.mockResolvedValue({ ok: true });
});

describe('updatePartnerMaterialAction', () => {
  it('гард раздела с кабинетом; без id или категории — validation без вызова сервиса', async () => {
    expect(
      await updatePartnerMaterialAction('leader', fd({ title: 'x', category: 'other' }))
    ).toMatchObject({
      ok: false,
      error: 'validation',
    });
    expect(
      await updatePartnerMaterialAction('admin', fd({ id: 'm1', category: 'weird' }))
    ).toMatchObject({
      ok: false,
      error: 'validation',
    });
    expect(requireSettingsSection).toHaveBeenCalledWith('catalogs.partnerMaterials', 'leader');
    expect(requireSettingsSection).toHaveBeenCalledWith('catalogs.partnerMaterials', 'admin');
    expect(updateMaterial).not.toHaveBeenCalled();
  });

  it('поля формы уходят в сервис; порядок — числом, пустой — не передаётся; обе страницы перечитываются', async () => {
    const r = await updatePartnerMaterialAction(
      'leader',
      fd({
        id: 'm1',
        title: 'Прайс',
        description: 'd',
        category: 'price_list',
        externalUrl: '',
        sortOrder: '3',
      })
    );
    expect(r).toEqual({ ok: true });
    expect(updateMaterial).toHaveBeenCalledWith({}, session, 'm1', {
      title: 'Прайс',
      description: 'd',
      category: 'price_list',
      externalUrl: '',
      sortOrder: 3,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings/processes/partner-materials');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/settings/processes/partner-materials');

    await updatePartnerMaterialAction(
      'leader',
      fd({ id: 'm1', title: 'Прайс', category: 'other', sortOrder: 'abc' })
    );
    expect(updateMaterial.mock.calls[1][3]).not.toHaveProperty('sortOrder');
  });

  it('ошибка сервиса возвращается как есть, страницы не перечитываются', async () => {
    updateMaterial.mockResolvedValueOnce({ ok: false, error: 'forbidden' });
    expect(
      await updatePartnerMaterialAction('leader', fd({ id: 'm1', title: 'x', category: 'other' }))
    ).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('publish / unpublish', () => {
  it('публикация: гард, сервис, перечитать; без id — validation; not_ready как есть', async () => {
    expect(await publishPartnerMaterialAction('admin', fd({ id: 'm1' }))).toEqual({ ok: true });
    expect(publishMaterial).toHaveBeenCalledWith({}, session, 'm1');
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(await publishPartnerMaterialAction('admin', fd({}))).toMatchObject({
      ok: false,
      error: 'validation',
    });
    publishMaterial.mockResolvedValueOnce({ ok: false, error: 'not_ready' });
    expect(await publishPartnerMaterialAction('admin', fd({ id: 'm1' }))).toEqual({
      ok: false,
      error: 'not_ready',
    });
  });

  it('снятие: гард, сервис, перечитать; без id — validation', async () => {
    expect(await unpublishPartnerMaterialAction('leader', fd({ id: 'm1' }))).toEqual({ ok: true });
    expect(unpublishMaterial).toHaveBeenCalledWith({}, session, 'm1');
    expect(await unpublishPartnerMaterialAction('leader', fd({}))).toMatchObject({
      ok: false,
      error: 'validation',
    });
    unpublishMaterial.mockResolvedValueOnce({ ok: false, error: 'not_found' });
    expect(await unpublishPartnerMaterialAction('leader', fd({ id: 'zz' }))).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});
