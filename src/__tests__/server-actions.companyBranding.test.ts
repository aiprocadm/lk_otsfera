/**
 * Этап 5 (PR-3) — тонкие адаптеры налогов/нумерации/оформления (`У-138`):
 * гард раздела `catalogs.requisites` в КАЖДОМ действии (урок PR-1/PR-2:
 * скрытая карточка — внешний вид, а не защита, §2b), разбор формы
 * ('none' → null, чекбоксы 'on', слот из белого списка), ревалидация
 * обоих хабов настроек только при успехе.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireSettingsSection,
  setCompanyTaxSettings,
  setCompanyDocumentNumbering,
  deleteCompanyBrandingAsset,
} = vi.hoisted(() => ({
  requireSettingsSection: vi.fn(),
  setCompanyTaxSettings: vi.fn(),
  setCompanyDocumentNumbering: vi.fn(),
  deleteCompanyBrandingAsset: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));
vi.mock('@/lib/services/admin/companyBranding', () => ({
  setCompanyTaxSettings,
  setCompanyDocumentNumbering,
  deleteCompanyBrandingAsset,
}));

import { revalidatePath } from 'next/cache';
import {
  deleteCompanyBrandingAction,
  setCompanyNumberingAction,
  setCompanyTaxSettingsAction,
} from '@/server-actions/admin/companyBranding';

const LEADER = { sub: 'l1', role: 'leader', companyId: 'co-1' };

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSettingsSection.mockResolvedValue(LEADER);
  setCompanyTaxSettings.mockResolvedValue({ ok: true });
  setCompanyDocumentNumbering.mockResolvedValue({ ok: true });
  deleteCompanyBrandingAsset.mockResolvedValue({ ok: true });
});

describe('гард раздела — в каждом действии', () => {
  it('каждое действие спрашивает право catalogs.requisites своего кабинета', async () => {
    await setCompanyTaxSettingsAction('leader', fd({ companyId: 'co-1', defaultVatRate: '0.2' }));
    await setCompanyNumberingAction('admin', fd({ companyId: 'co-1' }));
    await deleteCompanyBrandingAction('leader', fd({ companyId: 'co-1', slot: 'logo' }));
    expect(requireSettingsSection.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      ['catalogs.requisites', 'leader'],
      ['catalogs.requisites', 'admin'],
      ['catalogs.requisites', 'leader'],
    ]);
  });

  it('отказ гарда — до сервиса: default-deny профиль не долетает до мутации', async () => {
    requireSettingsSection.mockRejectedValue(new Error('REDIRECT:/forbidden'));
    await expect(
      setCompanyTaxSettingsAction('leader', fd({ companyId: 'co-1', defaultVatRate: '0.2' }))
    ).rejects.toThrow('REDIRECT:/forbidden');
    await expect(
      setCompanyNumberingAction('leader', fd({ companyId: 'co-1' }))
    ).rejects.toThrow('REDIRECT:/forbidden');
    await expect(
      deleteCompanyBrandingAction('leader', fd({ companyId: 'co-1', slot: 'logo' }))
    ).rejects.toThrow('REDIRECT:/forbidden');
    expect(setCompanyTaxSettings).not.toHaveBeenCalled();
    expect(setCompanyDocumentNumbering).not.toHaveBeenCalled();
    expect(deleteCompanyBrandingAsset).not.toHaveBeenCalled();
  });
});

describe('setCompanyTaxSettingsAction — разбор формы', () => {
  it('без companyId — validation, сервис не тронут', async () => {
    expect(await setCompanyTaxSettingsAction('admin', fd({ defaultVatRate: '0.2' }))).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Не выбрана компания'],
    });
    expect(setCompanyTaxSettings).not.toHaveBeenCalled();
  });

  it("'none' → null, чекбокс 'on' → true", async () => {
    await setCompanyTaxSettingsAction(
      'leader',
      fd({ companyId: 'co-1', defaultVatRate: 'none', pricesIncludeVat: 'on' })
    );
    expect(setCompanyTaxSettings).toHaveBeenCalledWith({}, LEADER, 'co-1', {
      defaultVatRate: null,
      pricesIncludeVat: true,
    });
  });

  it('пустая ставка тоже null; снятый чекбокс → false', async () => {
    await setCompanyTaxSettingsAction('admin', fd({ companyId: 'co-2' }));
    expect(setCompanyTaxSettings).toHaveBeenCalledWith({}, LEADER, 'co-2', {
      defaultVatRate: null,
      pricesIncludeVat: false,
    });
  });

  it('ставка долей доезжает как есть; успех ревалидирует оба хаба', async () => {
    expect(
      await setCompanyTaxSettingsAction('leader', fd({ companyId: 'co-1', defaultVatRate: '0.05' }))
    ).toEqual({ ok: true });
    expect(setCompanyTaxSettings).toHaveBeenCalledWith({}, LEADER, 'co-1', {
      defaultVatRate: '0.05',
      pricesIncludeVat: false,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/settings');
  });

  it('ошибка сервиса возвращается как есть, без ревалидации', async () => {
    setCompanyTaxSettings.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(
      await setCompanyTaxSettingsAction('leader', fd({ companyId: 'co-2', defaultVatRate: '0.2' }))
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('setCompanyNumberingAction — разбор формы', () => {
  it('без companyId — validation, сервис не тронут', async () => {
    expect(await setCompanyNumberingAction('admin', fd({ prefixInvoice: 'СЧ' }))).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Не выбрана компания'],
    });
    expect(setCompanyDocumentNumbering).not.toHaveBeenCalled();
  });

  it('четыре префикса и resetYearly=on собираются в структуру нумерации', async () => {
    await setCompanyNumberingAction(
      'leader',
      fd({
        companyId: 'co-1',
        prefixInvoice: 'СЧ',
        prefixAct: 'АКТ',
        prefixContract: 'Д',
        prefixSupplementary: 'ДС',
        resetYearly: 'on',
      })
    );
    expect(setCompanyDocumentNumbering).toHaveBeenCalledWith({}, LEADER, 'co-1', {
      prefixes: { invoice: 'СЧ', act: 'АКТ', contract: 'Д', supplementary: 'ДС' },
      resetYearly: true,
    });
  });

  it('пустая форма → пустые префиксы и resetYearly=false; успех ревалидирует оба хаба', async () => {
    expect(await setCompanyNumberingAction('admin', fd({ companyId: 'co-1' }))).toEqual({
      ok: true,
    });
    expect(setCompanyDocumentNumbering).toHaveBeenCalledWith({}, LEADER, 'co-1', {
      prefixes: { invoice: '', act: '', contract: '', supplementary: '' },
      resetYearly: false,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/settings');
  });

  it('ошибка сервиса (validation с текстом) возвращается как есть, без ревалидации', async () => {
    setCompanyDocumentNumbering.mockResolvedValue({
      ok: false,
      error: 'validation',
      messages: ['Префикс: до 12 символов — буквы, цифры, дефис.'],
    });
    expect(
      await setCompanyNumberingAction('leader', fd({ companyId: 'co-1', prefixAct: '!'.repeat(13) }))
    ).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Префикс: до 12 символов — буквы, цифры, дефис.'],
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('deleteCompanyBrandingAction — разбор формы', () => {
  it('кривой слот из подделанной формы — validation, сервис не тронут', async () => {
    expect(
      await deleteCompanyBrandingAction('admin', fd({ companyId: 'co-1', slot: 'seal' }))
    ).toEqual({ ok: false, error: 'validation', messages: ['Не выбраны компания и слот'] });
    expect(deleteCompanyBrandingAsset).not.toHaveBeenCalled();
  });

  it('без companyId — validation даже при валидном слоте', async () => {
    expect(await deleteCompanyBrandingAction('admin', fd({ slot: 'logo' }))).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Не выбраны компания и слот'],
    });
    expect(deleteCompanyBrandingAsset).not.toHaveBeenCalled();
  });

  it('happy-path: слот доезжает до сервиса, успех ревалидирует оба хаба', async () => {
    expect(
      await deleteCompanyBrandingAction('leader', fd({ companyId: 'co-1', slot: 'stamp' }))
    ).toEqual({ ok: true });
    expect(deleteCompanyBrandingAsset).toHaveBeenCalledWith({}, LEADER, 'co-1', 'stamp');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/settings');
  });

  it('ошибка сервиса возвращается как есть, без ревалидации', async () => {
    deleteCompanyBrandingAsset.mockResolvedValue({ ok: false, error: 'not_found' });
    expect(
      await deleteCompanyBrandingAction('leader', fd({ companyId: 'co-1', slot: 'logo' }))
    ).toEqual({ ok: false, error: 'not_found' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
