// @vitest-environment jsdom
/**
 * `У-138` — блоки «Налоги» и «Нумерация документов» экрана «Реквизиты
 * исполнителя». Проверяем разбор формы и предзаполнение: ставка хранится
 * строкой фиксированной точности ('0.2000'), а селект знает доли ('0.2') —
 * несовпадение молча показало бы «не облагается» у компании с НДС 20%.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { taxAction, numberingAction, toastSuccess, refresh } = vi.hoisted(() => ({
  taxAction: vi.fn(),
  numberingAction: vi.fn(),
  toastSuccess: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/server-actions/admin/companyBranding', () => ({
  setCompanyTaxSettingsAction: taxAction,
  setCompanyNumberingAction: numberingAction,
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import {
  CompanyNumberingForm,
  CompanyTaxForm,
} from '@/components/settings/company-tax-numbering-forms';

beforeEach(() => {
  vi.clearAllMocks();
  taxAction.mockResolvedValue({ ok: true });
  numberingAction.mockResolvedValue({ ok: true });
});

describe('CompanyTaxForm', () => {
  it('предзаполнение из «0.2000» даёт 20%, а не «не облагается»', () => {
    render(
      React.createElement(CompanyTaxForm, {
        cabinet: 'admin' as const,
        companyId: 'co-1',
        defaultVatRate: '0.2000',
        pricesIncludeVat: true,
      })
    );
    const select = screen.getByLabelText('Ставка НДС по умолчанию') as HTMLSelectElement;
    expect(select.value).toBe('0.2');
    expect((screen.getByLabelText('цены включают НДС') as HTMLInputElement).checked).toBe(true);
  });

  it('null = «не облагается»; сабмит несёт кабинет, companyId и снятый чекбокс', async () => {
    render(
      React.createElement(CompanyTaxForm, {
        cabinet: 'leader' as const,
        companyId: 'co-1',
        defaultVatRate: null,
        pricesIncludeVat: false,
      })
    );
    expect((screen.getByLabelText('Ставка НДС по умолчанию') as HTMLSelectElement).value).toBe(
      'none'
    );

    fireEvent.submit(screen.getByRole('button', { name: 'Сохранить' }).closest('form')!);
    await waitFor(() => expect(taxAction).toHaveBeenCalled());
    expect(taxAction.mock.calls[0]![0]).toBe('leader');
    const fd = taxAction.mock.calls[0]![1] as FormData;
    expect(fd.get('companyId')).toBe('co-1');
    expect(fd.get('defaultVatRate')).toBe('none');
    // Снятый чекбокс в FormData не попадает — сервис прочитает это как false.
    expect(fd.get('pricesIncludeVat')).toBeNull();
    expect(toastSuccess).toHaveBeenCalledWith('Налоговые настройки сохранены.');
    expect(refresh).toHaveBeenCalled();
  });

  it('отказ прав объясняется словами, а не кодом; refresh не зовётся', async () => {
    taxAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(
      React.createElement(CompanyTaxForm, {
        cabinet: 'admin' as const,
        companyId: 'co-1',
        defaultVatRate: '0',
        pricesIncludeVat: true,
      })
    );
    fireEvent.submit(screen.getByRole('button', { name: 'Сохранить' }).closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Нет прав');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('validation с пояснениями показывается списком', async () => {
    taxAction.mockResolvedValue({
      ok: false,
      error: 'validation',
      messages: ['Ставка НДС: 0%, 5%, 7%, 10%, 20% или «не облагается»'],
    });
    render(
      React.createElement(CompanyTaxForm, {
        cabinet: 'admin' as const,
        companyId: 'co-1',
        defaultVatRate: null,
        pricesIncludeVat: true,
      })
    );
    fireEvent.submit(screen.getByRole('button', { name: 'Сохранить' }).closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').querySelectorAll('li')).toHaveLength(1);
  });

  it('незнакомый код ошибки не показывается сырым', async () => {
    taxAction.mockResolvedValue({ ok: false, error: 'company_required' });
    render(
      React.createElement(CompanyTaxForm, {
        cabinet: 'admin' as const,
        companyId: 'co-1',
        defaultVatRate: null,
        pricesIncludeVat: true,
      })
    );
    fireEvent.submit(screen.getByRole('button', { name: 'Сохранить' }).closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    // Человек видит русскую строку из общего словаря, а не машинный код.
    expect(screen.getByRole('alert').textContent).not.toBe('company_required');
  });
});

describe('CompanyNumberingForm', () => {
  it('предзаполняется сохранённым шаблоном и шлёт все четыре префикса', async () => {
    render(
      React.createElement(CompanyNumberingForm, {
        cabinet: 'admin' as const,
        companyId: 'co-1',
        numbering: {
          prefixes: { invoice: 'СЧ', act: 'АКТ', contract: 'Д', supplementary: 'ДС' },
          resetYearly: true,
        },
      })
    );
    expect((screen.getByLabelText('Счёт') as HTMLInputElement).value).toBe('СЧ');
    expect((screen.getByLabelText('Доп. соглашение') as HTMLInputElement).value).toBe('ДС');

    fireEvent.submit(screen.getByRole('button', { name: 'Сохранить' }).closest('form')!);
    await waitFor(() => expect(numberingAction).toHaveBeenCalled());
    const fd = numberingAction.mock.calls[0]![1] as FormData;
    expect(fd.get('prefixInvoice')).toBe('СЧ');
    expect(fd.get('prefixContract')).toBe('Д');
    expect(fd.get('resetYearly')).toBe('on');
    expect(toastSuccess).toHaveBeenCalledWith('Шаблон нумерации сохранён.');
  });

  it('без сохранённого шаблона поля пустые, обнуление выключено', () => {
    render(
      React.createElement(CompanyNumberingForm, {
        cabinet: 'leader' as const,
        companyId: 'co-1',
        numbering: null,
      })
    );
    expect((screen.getByLabelText('Счёт') as HTMLInputElement).value).toBe('');
    expect(
      (screen.getByLabelText('обнулять счётчик каждый год') as HTMLInputElement).checked
    ).toBe(false);
  });

  it('отказ сервиса показывается в alert', async () => {
    numberingAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(
      React.createElement(CompanyNumberingForm, {
        cabinet: 'admin' as const,
        companyId: 'co-1',
        numbering: null,
      })
    );
    fireEvent.submit(screen.getByRole('button', { name: 'Сохранить' }).closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('не найдена');
  });
});
