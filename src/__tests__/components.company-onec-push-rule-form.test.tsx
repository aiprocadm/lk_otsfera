// @vitest-environment jsdom
/**
 * `У-169` — блок «Выгрузка документов в 1С» экрана «Реквизиты исполнителя»:
 * три варианта правила, четыре флажка типов (КП среди них нет — `Р-14`),
 * предзаполнение сохранённым правилом, сабмит с кабинетом и всеми отмеченными
 * типами, ошибка по-русски.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { ruleAction, toastSuccess, refresh } = vi.hoisted(() => ({
  ruleAction: vi.fn(),
  toastSuccess: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/server-actions/admin/oneCDocumentPushRule', () => ({
  setOneCDocumentPushRuleAction: ruleAction,
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { CompanyOneCPushRuleForm } from '@/components/settings/company-onec-push-rule-form';

beforeEach(() => {
  vi.clearAllMocks();
  ruleAction.mockResolvedValue({ ok: true });
});

function renderForm(over: Partial<React.ComponentProps<typeof CompanyOneCPushRuleForm>> = {}) {
  return render(
    React.createElement(CompanyOneCPushRuleForm, {
      cabinet: 'admin' as const,
      companyId: 'co-1',
      mode: 'manual' as const,
      types: ['invoice', 'act', 'contract', 'extra_agreement'] as const as never,
      ...over,
    })
  );
}

describe('CompanyOneCPushRuleForm', () => {
  it('три варианта правила и четыре типа; КП среди типов нет', () => {
    renderForm();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(['auto', 'manual', 'never']);
    expect(screen.getByLabelText(/только по кнопке/)).toBeTruthy();
    expect(screen.getByLabelText(/автоматически при выпуске/)).toBeTruthy();
    expect(screen.getByLabelText(/никогда/)).toBeTruthy();

    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => b.value)).toEqual(['invoice', 'act', 'contract', 'extra_agreement']);
    expect(screen.queryByLabelText(/Коммерческое предложение/)).toBeNull();
    expect(screen.getByLabelText('Счёт')).toBeTruthy();
    expect(screen.getByLabelText('Доп. соглашение')).toBeTruthy();
  });

  it('предзаполняется сохранённым правилом', () => {
    renderForm({ mode: 'never', types: ['act'] });
    expect((screen.getByLabelText(/никогда/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/только по кнопке/) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Акт') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Счёт') as HTMLInputElement).checked).toBe(false);
  });

  it('сабмит несёт кабинет, companyId, режим и ВСЕ отмеченные типы', async () => {
    renderForm({ cabinet: 'leader', mode: 'manual', types: ['invoice', 'contract'] });
    fireEvent.click(screen.getByLabelText(/автоматически при выпуске/));
    fireEvent.click(screen.getByLabelText('Договор')); // снять
    fireEvent.submit(screen.getByRole('button', { name: 'Сохранить' }).closest('form')!);
    await waitFor(() => expect(ruleAction).toHaveBeenCalled());
    expect(ruleAction.mock.calls[0]![0]).toBe('leader');
    const fd = ruleAction.mock.calls[0]![1] as FormData;
    expect(fd.get('companyId')).toBe('co-1');
    expect(fd.get('mode')).toBe('auto');
    expect(fd.getAll('types')).toEqual(['invoice']);
    expect(toastSuccess).toHaveBeenCalledWith('Правило выгрузки в 1С сохранено.');
    expect(refresh).toHaveBeenCalled();
  });

  it('отказ прав — словами, без refresh; invalid_types — строка из словаря', async () => {
    ruleAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { unmount } = renderForm();
    fireEvent.submit(screen.getByRole('button', { name: 'Сохранить' }).closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Нет прав');
    expect(refresh).not.toHaveBeenCalled();
    unmount();

    ruleAction.mockResolvedValue({ ok: false, error: 'invalid_types' });
    renderForm();
    fireEvent.submit(screen.getByRole('button', { name: 'Сохранить' }).closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('только счёт, акт, договор');
    expect(screen.getByRole('alert').textContent).not.toContain('invalid_types');
  });

  it('незнакомый код ошибки не показывается сырым', async () => {
    ruleAction.mockResolvedValue({ ok: false, error: 'something_odd' });
    renderForm();
    fireEvent.submit(screen.getByRole('button', { name: 'Сохранить' }).closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe('Не удалось сохранить правило.');
  });
});
