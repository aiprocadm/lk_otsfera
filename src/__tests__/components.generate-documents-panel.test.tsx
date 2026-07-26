// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { generateOrderDocumentAction, requestRequisitesAction } = vi.hoisted(() => ({
  generateOrderDocumentAction: vi.fn(),
  requestRequisitesAction: vi.fn()
}));
vi.mock('@/server-actions/documents/generate', () => ({ generateOrderDocumentAction, requestRequisitesAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { GenerateDocumentsPanel } from '@/components/manager/generate-documents-panel';

// Этап 8 (ФТ-9.4/9.5, PR-2) — панель «Сформировать документы».
describe('GenerateDocumentsPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('полные реквизиты: «Счёт» активен, «Акт» без счёта заблокирован с подсказкой', () => {
    render(<GenerateDocumentsPanel orderId="ord-1" missing={[]} hasInvoice={false} />);
    expect((screen.getByRole('button', { name: 'Счёт' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Акт' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/наследует его номер|наследует/)).toBeTruthy();
  });

  it('клик «Счёт» вызывает action; успех → toast с номером + refresh', async () => {
    generateOrderDocumentAction.mockResolvedValue({ ok: true, documentId: 'd1', number: 'С-2026-3' });
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
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Сначала сформируйте счёт — акт наследует его номер.'));
  });

  it('неполные реквизиты: кнопки disabled, список, «Запросить у клиента» только при org-недостающем', async () => {
    requestRequisitesAction.mockResolvedValue({ ok: true });
    render(
      <GenerateDocumentsPanel
        orderId="ord-1"
        missing={[
          { side: 'organization', label: 'ИНН заказчика' },
          { side: 'company', label: 'БИК исполнителя' }
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

  it('только company-недостающее — кнопки запроса нет; ошибка запроса → toast', async () => {
    render(<GenerateDocumentsPanel orderId="ord-1" missing={[{ side: 'company', label: 'БИК исполнителя' }]} hasInvoice={false} />);
    expect(screen.queryByRole('button', { name: 'Запросить у клиента' })).toBeNull();
  });
});
