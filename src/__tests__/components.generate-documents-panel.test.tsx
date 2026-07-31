// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { generateOrderDocumentAction, requestRequisitesAction } = vi.hoisted(() => ({
  generateOrderDocumentAction: vi.fn(),
  requestRequisitesAction: vi.fn(),
}));
vi.mock('@/server-actions/documents/generate', () => ({
  generateOrderDocumentAction,
  requestRequisitesAction,
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { GenerateDocumentsPanel } from '@/components/manager/generate-documents-panel';

// Этап 8 (ФТ-9.4/9.5, PR-2) — панель «Сформировать документы».
describe('GenerateDocumentsPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('полные реквизиты: «Счёт»/«Договор» активны, ведомые без ведущего заблокированы', () => {
    render(<GenerateDocumentsPanel orderId="ord-1" missing={[]} hasInvoice={false} />);
    expect((screen.getByRole('button', { name: 'Счёт' }) as HTMLButtonElement).disabled).toBe(
      false
    );
    expect((screen.getByRole('button', { name: 'Договор' }) as HTMLButtonElement).disabled).toBe(
      false
    );
    expect((screen.getByRole('button', { name: 'Акт' }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Доп. соглашение' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(screen.getByText(/наследует его номер/)).toBeTruthy();
  });

  it('PR-3: договор формируется, доп. соглашение разблокируется при hasContract', async () => {
    generateOrderDocumentAction.mockResolvedValue({
      ok: true,
      documentId: 'd9',
      number: 'Д-2026-4',
    });
    const { rerender } = render(
      <GenerateDocumentsPanel orderId="ord-1" missing={[]} hasInvoice={true} hasContract={false} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Договор' }));
    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalled());
    expect((generateOrderDocumentAction.mock.calls[0]![0] as FormData).get('docType')).toBe(
      'contract'
    );
    expect(toastSuccess).toHaveBeenCalledWith('Договор № Д-2026-4 сформирован.');

    rerender(
      <GenerateDocumentsPanel orderId="ord-1" missing={[]} hasInvoice={true} hasContract={true} />
    );
    expect(
      (screen.getByRole('button', { name: 'Доп. соглашение' }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('PR-3: contract_required мапится в русский текст', async () => {
    generateOrderDocumentAction.mockResolvedValue({ ok: false, error: 'contract_required' });
    render(
      <GenerateDocumentsPanel orderId="ord-1" missing={[]} hasInvoice={true} hasContract={true} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Доп. соглашение' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Сначала сформируйте договор — доп. соглашение наследует его номер.'
      )
    );
  });

  it('клик «Счёт» вызывает action; успех → toast с номером + refresh', async () => {
    generateOrderDocumentAction.mockResolvedValue({
      ok: true,
      documentId: 'd1',
      number: 'С-2026-3',
    });
    render(<GenerateDocumentsPanel orderId="ord-1" missing={[]} hasInvoice={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Счёт' }));
    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalled());
    const fd = generateOrderDocumentAction.mock.calls[0]![0] as FormData;
    expect(fd.get('orderId')).toBe('ord-1');
    expect(fd.get('docType')).toBe('invoice');
    expect(toastSuccess).toHaveBeenCalledWith('Счёт № С-2026-3 сформирован.');
    expect(refresh).toHaveBeenCalled();
  });

  it('ошибки мапятся в русские тексты (invoice_required)', async () => {
    generateOrderDocumentAction.mockResolvedValue({ ok: false, error: 'invoice_required' });
    render(<GenerateDocumentsPanel orderId="ord-1" missing={[]} hasInvoice={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Акт' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Сначала сформируйте счёт — акт наследует его номер.')
    );
  });

  it('неполные реквизиты: кнопки disabled, список, «Запросить у клиента» только при org-недостающем', async () => {
    requestRequisitesAction.mockResolvedValue({ ok: true });
    render(
      <GenerateDocumentsPanel
        orderId="ord-1"
        missing={[
          { side: 'organization', label: 'ИНН заказчика' },
          { side: 'company', label: 'БИК исполнителя' },
        ]}
        hasInvoice={false}
      />
    );
    expect((screen.getByRole('button', { name: 'Счёт' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('missing-requisites').textContent).toContain('ИНН заказчика');
    expect(screen.getByText(/исполнителя заполняет администратор/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Запросить у клиента' }));
    await waitFor(() => expect(requestRequisitesAction).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith('Запрос реквизитов отправлен организации.');
  });

  it('только company-недостающее — кнопки запроса нет', async () => {
    render(
      <GenerateDocumentsPanel
        orderId="ord-1"
        missing={[{ side: 'company', label: 'БИК исполнителя' }]}
        hasInvoice={false}
      />
    );
    expect(screen.queryByRole('button', { name: 'Запросить у клиента' })).toBeNull();
  });

  it('отказ запроса реквизитов показывается ошибкой, а не молчаливым успехом', async () => {
    // Запрос уходит уведомлением клиенту. Если экшен отказал (заказ передали,
    // права изменились), менеджер должен это увидеть — иначе он будет ждать
    // реквизитов, которых никто не просил.
    requestRequisitesAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(
      <GenerateDocumentsPanel
        orderId="ord-1"
        missing={[{ side: 'organization', label: 'ИНН заказчика' }]}
        hasInvoice={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Запросить у клиента' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось отправить запрос.'));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('незнакомый код ошибки генерации → общий русский текст', async () => {
    // У панели свой словарь понятных сообщений. Новый код из сервиса не должен
    // оставлять пользователя с пустым toast.
    generateOrderDocumentAction.mockResolvedValue({ ok: false, error: 'quota_exceeded' });
    render(<GenerateDocumentsPanel orderId="ord-1" missing={[]} hasInvoice={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Счёт' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Не удалось сформировать документ.')
    );
  });
});
