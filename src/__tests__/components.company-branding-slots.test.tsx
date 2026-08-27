// @vitest-environment jsdom
/**
 * `У-138` — слоты оформления документов (логотип · подпись · печать).
 *
 * Ключевые инварианты экрана: предпросмотр показывается ТОЛЬКО у файла,
 * прошедшего антивирус; про непроверенный и заражённый человек читает прямым
 * текстом (§15), а не гадает по пустому месту; файл больше 1 МБ отбивается на
 * клиенте — гонять мегабайты ради заведомого 413 незачем.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react';

const { deleteAction, toastSuccess, refresh } = vi.hoisted(() => ({
  deleteAction: vi.fn(),
  toastSuccess: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/server-actions/admin/companyBranding', () => ({
  deleteCompanyBrandingAction: deleteAction,
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { CompanyBrandingSlots } from '@/components/settings/company-branding-slots';
import type { BrandingSlotView } from '@/lib/services/admin/companyBranding';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function view(over: Partial<BrandingSlotView> = {}): BrandingSlotView {
  return {
    slot: 'logo',
    label: 'Логотип',
    scanStatus: 'clean',
    previewUrl: 'https://s3.example/logo.png?sig=1',
    mime: 'image/png',
    ...over,
  };
}

function mount(slots: BrandingSlotView[]) {
  return render(
    React.createElement(CompanyBrandingSlots, {
      cabinet: 'admin' as const,
      companyId: 'co-1',
      slots,
    })
  );
}

/** Файл нужного размера без выделения мегабайтов в памяти. */
function fileOf(name: string, type: string, size: number): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function setFile(container: HTMLElement, slot: string, file: File) {
  const input = within(
    container.querySelector(`[data-testid="branding-slot-${slot}"]`) as HTMLElement
  ).getByLabelText(/файл/i) as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteAction.mockResolvedValue({ ok: true });
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
});

describe('CompanyBrandingSlots', () => {
  it('рендерит все три слота, даже когда файлов нет вовсе', () => {
    const { container } = mount([]);
    for (const slot of ['logo', 'signature', 'stamp']) {
      expect(container.querySelector(`[data-testid="branding-slot-${slot}"]`)).not.toBeNull();
    }
    expect(container.textContent).toContain('Файл не загружен');
  });

  it('clean — предпросмотр; pending — «проверяется»; infected — красная плашка', () => {
    const { container } = mount([
      view(),
      view({ slot: 'signature', label: 'Подпись', scanStatus: 'pending', previewUrl: null }),
      view({ slot: 'stamp', label: 'Печать', scanStatus: 'infected', previewUrl: null }),
    ]);

    const logo = container.querySelector('[data-testid="branding-slot-logo"]')!;
    expect(logo.querySelector('img')?.getAttribute('src')).toContain('s3.example');

    const sign = container.querySelector('[data-testid="branding-slot-signature"]')!;
    expect(sign.textContent).toContain('антивирус');
    expect(sign.querySelector('img')).toBeNull();

    const stamp = container.querySelector('[data-testid="branding-slot-stamp"]')!;
    expect(stamp.querySelector('[role="alert"]')?.textContent).toContain('не прошёл проверку');
  });

  it('файл больше 1 МБ отбивается на клиенте — запрос не уходит', async () => {
    const { container } = mount([]);
    setFile(container, 'logo', fileOf('big.png', 'image/png', 2 * 1024 * 1024));
    fireEvent.submit(
      within(container.querySelector('[data-testid="branding-slot-logo"]') as HTMLElement)
        .getByRole('button', { name: /загрузить/i })
        .closest('form')!
    );
    await waitFor(() =>
      expect(container.querySelector('[data-testid="branding-slot-logo"] [role="alert"]')).not.toBeNull()
    );
    expect(container.textContent).toContain('1 МБ');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('успешная загрузка шлёт companyId и слот, тостит про антивирус и обновляет экран', async () => {
    const { container } = mount([]);
    setFile(container, 'stamp', fileOf('stamp.svg', 'image/svg+xml', 1024));
    fireEvent.submit(
      within(container.querySelector('[data-testid="branding-slot-stamp"]') as HTMLElement)
        .getByRole('button', { name: /загрузить/i })
        .closest('form')!
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/company/branding');
    const fd = (init as { body: FormData }).body;
    expect(fd.get('companyId')).toBe('co-1');
    expect(fd.get('slot')).toBe('stamp');
    expect(toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining('проверяется антивирусом')
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('отказ сервера объясняется по-русски (413 → про 1 МБ)', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'too_large' }) });
    const { container } = mount([]);
    setFile(container, 'logo', fileOf('ok.png', 'image/png', 1024));
    fireEvent.submit(
      within(container.querySelector('[data-testid="branding-slot-logo"]') as HTMLElement)
        .getByRole('button', { name: /загрузить/i })
        .closest('form')!
    );
    await waitFor(() =>
      expect(container.querySelector('[data-testid="branding-slot-logo"] [role="alert"]')).not.toBeNull()
    );
    expect(container.textContent).toContain('1 МБ');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('сетевой сбой не молчит', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const { container } = mount([]);
    setFile(container, 'logo', fileOf('ok.png', 'image/png', 1024));
    fireEvent.submit(
      within(container.querySelector('[data-testid="branding-slot-logo"]') as HTMLElement)
        .getByRole('button', { name: /загрузить/i })
        .closest('form')!
    );
    await waitFor(() =>
      expect(container.querySelector('[data-testid="branding-slot-logo"] [role="alert"]')).not.toBeNull()
    );
  });

  it('сабмит без выбранного файла — объяснение, а не пустой запрос', async () => {
    const { container } = mount([]);
    fireEvent.submit(
      within(container.querySelector('[data-testid="branding-slot-logo"]') as HTMLElement)
        .getByRole('button', { name: /загрузить/i })
        .closest('form')!
    );
    await waitFor(() =>
      expect(container.querySelector('[data-testid="branding-slot-logo"] [role="alert"]')).not.toBeNull()
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('статус «error» — терминальный: своя плашка, а не вечное «проверяется»', () => {
    // Ревью PR-3: раньше `error` попадал в ветку ожидания и висел там навсегда.
    const { container } = mount([view({ scanStatus: 'error', previewUrl: null })]);
    const logo = container.querySelector('[data-testid="branding-slot-logo"]')!;
    expect(logo.querySelector('[role="alert"]')?.textContent).toContain('загрузите его ещё раз');
  });

  it('нечитаемое тело ответа не молчит: показывается запасная формулировка', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    });
    const { container } = mount([]);
    setFile(container, 'logo', fileOf('ok.png', 'image/png', 1024));
    fireEvent.submit(
      within(container.querySelector('[data-testid="branding-slot-logo"]') as HTMLElement)
        .getByRole('button', { name: /загрузить/i })
        .closest('form')!
    );
    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="branding-slot-logo"] [role="alert"]')
      ).not.toBeNull()
    );
  });

  it('validation с пояснениями сервера показывается человеку целиком', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'validation', messages: ['SVG отклонён: скрипт внутри файла.'] }),
    });
    const { container } = mount([]);
    setFile(container, 'stamp', fileOf('bad.svg', 'image/svg+xml', 512));
    fireEvent.submit(
      within(container.querySelector('[data-testid="branding-slot-stamp"]') as HTMLElement)
        .getByRole('button', { name: /загрузить/i })
        .closest('form')!
    );
    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="branding-slot-stamp"] [role="alert"]')?.textContent
      ).toContain('SVG отклонён')
    );
  });

  it('удаление зовёт действие с кабинетом и слотом; отказ показывается', async () => {
    const { container } = mount([view()]);
    fireEvent.click(
      within(container.querySelector('[data-testid="branding-slot-logo"]') as HTMLElement).getByRole(
        'button',
        { name: 'Удалить' }
      )
    );
    await waitFor(() => expect(deleteAction).toHaveBeenCalled());
    expect(deleteAction.mock.calls[0]![0]).toBe('admin');
    expect((deleteAction.mock.calls[0]![1] as FormData).get('slot')).toBe('logo');
    expect(toastSuccess).toHaveBeenCalledWith('«Логотип» удалён.');

    deleteAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    fireEvent.click(
      within(container.querySelector('[data-testid="branding-slot-logo"]') as HTMLElement).getByRole(
        'button',
        { name: 'Удалить' }
      )
    );
    await waitFor(() =>
      expect(container.querySelector('[data-testid="branding-slot-logo"] [role="alert"]')).not.toBeNull()
    );
  });
});
