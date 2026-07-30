// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { CertificateScanTarget } from '@/lib/services/manager/certificateScans';

/**
 * Этап 12 PR-2 (ФТ-5.3) — панель массовой загрузки сканов.
 * Главное требование ТЗ: автосопоставление — ПОДСКАЗКА, отправка невозможна,
 * пока слушатель не выбран для каждого файла.
 */

const { success, error } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success, error } }));

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { CertificateScansPanel } from '@/components/manager/certificate-scans-panel';

const TARGETS: CertificateScanTarget[] = [
  {
    itemId: 'i1',
    studentName: 'Иванов Иван',
    certificateId: 'c1',
    certificateNumber: 'АБ-1',
    hasScan: false
  },
  {
    itemId: 'i2',
    studentName: 'Петрова Анна',
    certificateId: 'c2',
    certificateNumber: 'АБ-2',
    hasScan: true
  }
];

function pdf(name: string) {
  return new File([new Uint8Array([1])], name, { type: 'application/pdf' });
}

function pickFiles(files: File[]) {
  const input = screen.getByLabelText('Файлы сканов') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, results: [] })
  }) as never;
});

describe('CertificateScansPanel', () => {
  it('без выданных удостоверений объясняет, почему грузить нечего', () => {
    render(
      <CertificateScansPanel
        orderId='o1'
        targets={[
          {
            itemId: 'i1',
            studentName: 'Иванов',
            certificateId: null,
            certificateNumber: null,
            hasScan: false
          }
        ]}
      />
    );
    expect(screen.getByText(/после того, как слушателям выданы удостоверения/i)).toBeTruthy();
    expect(screen.queryByLabelText('Файлы сканов')).toBeNull();
  });

  it('счётчик «без скана» считает только удостоверения без файла', () => {
    render(<CertificateScansPanel orderId='o1' targets={TARGETS} />);
    expect(screen.getByText('Без скана: 1')).toBeTruthy();
  });

  it('когда все сканы на месте — зелёная отметка', () => {
    render(
      <CertificateScansPanel
        orderId='o1'
        targets={[{ ...TARGETS[0], hasScan: true }]}
      />
    );
    expect(screen.getByText('Все сканы загружены')).toBeTruthy();
  });

  it('однозначное совпадение подставляется и помечается подсказкой', () => {
    render(<CertificateScansPanel orderId='o1' targets={TARGETS} />);
    pickFiles([pdf('Иванов_скан.pdf')]);
    const select = screen.getByLabelText('Слушатель для файла Иванов_скан.pdf') as HTMLSelectElement;
    expect(select.value).toBe('i1');
    expect(screen.getByText('подсказка')).toBeTruthy();
  });

  it('без совпадения слушатель не выбран и отправка блокируется', async () => {
    render(<CertificateScansPanel orderId='o1' targets={TARGETS} />);
    pickFiles([pdf('scan001.pdf')]);
    const select = screen.getByLabelText('Слушатель для файла scan001.pdf') as HTMLSelectElement;
    expect(select.value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Загрузить сканы' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('выберите слушателя');
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('ручной выбор снимает метку подсказки', () => {
    render(<CertificateScansPanel orderId='o1' targets={TARGETS} />);
    pickFiles([pdf('Иванов.pdf')]);
    expect(screen.getByText('подсказка')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Слушатель для файла Иванов.pdf'), {
      target: { value: 'i2' }
    });
    expect(screen.queryByText('подсказка')).toBeNull();
  });

  it('ручной выбор меняет только свою строку, соседняя не сбивается', () => {
    // Файлов обычно несколько. Смена слушателя у одного файла не должна
    // перетирать выбор у остальных — иначе сканы уедут не тем людям.
    render(<CertificateScansPanel orderId='o1' targets={TARGETS} />);
    pickFiles([pdf('Иванов.pdf'), pdf('Петров.pdf')]);

    const first = screen.getByLabelText('Слушатель для файла Иванов.pdf') as HTMLSelectElement;
    const second = screen.getByLabelText('Слушатель для файла Петров.pdf') as HTMLSelectElement;
    const secondBefore = second.value;

    fireEvent.change(first, { target: { value: 'i2' } });

    expect(first.value).toBe('i2');
    expect(second.value).toBe(secondBefore);
  });

  it('отправляет пары файл/позиция и показывает пофайловый итог', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        results: [
          { fileName: 'Иванов.pdf', ok: true, orderItemId: 'i1', documentId: 'd1' },
          { fileName: 'Петрова.pdf', ok: false, orderItemId: 'i2', error: 'invalid_mime' }
        ]
      })
    });
    render(<CertificateScansPanel orderId='o1' targets={TARGETS} />);
    pickFiles([pdf('Иванов.pdf'), pdf('Петрова.pdf')]);
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить сканы' }));

    await waitFor(() => expect(success).toHaveBeenCalledWith('Загружено сканов: 1'));
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/manager/orders/o1/certificate-scans');
    expect((init.body as FormData).getAll('orderItemId')).toEqual(['i1', 'i2']);
    expect(screen.getByText(/Петрова.pdf — недопустимый тип файла/)).toBeTruthy();
    expect(error).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('неизвестный код ошибки показывается общим текстом', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        results: [{ fileName: 'Иванов.pdf', ok: false, orderItemId: 'i1', error: 'что-то' }]
      })
    });
    render(<CertificateScansPanel orderId='o1' targets={TARGETS} />);
    pickFiles([pdf('Иванов.pdf')]);
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить сканы' }));
    await waitFor(() =>
      expect(screen.getByText(/Иванов.pdf — не удалось загрузить/)).toBeTruthy()
    );
  });

  it('отказ роута показывается одной ошибкой', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false, error: 'forbidden' })
    });
    render(<CertificateScansPanel orderId='o1' targets={TARGETS} />);
    pickFiles([pdf('Иванов.pdf')]);
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить сканы' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Не удалось загрузить сканы')
    );
  });

  it('сетевой сбой сообщается пользователю', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
    render(<CertificateScansPanel orderId='o1' targets={TARGETS} />);
    pickFiles([pdf('Иванов.pdf')]);
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить сканы' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Сеть недоступна')
    );
  });

  it('«Очистить» убирает выбранные файлы', () => {
    render(<CertificateScansPanel orderId='o1' targets={TARGETS} />);
    pickFiles([pdf('Иванов.pdf')]);
    expect(screen.getByLabelText('Слушатель для файла Иванов.pdf')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Очистить' }));
    expect(screen.queryByLabelText('Слушатель для файла Иванов.pdf')).toBeNull();
  });

  it('без выбранных файлов кнопка загрузки неактивна', () => {
    render(<CertificateScansPanel orderId='o1' targets={TARGETS} />);
    const btn = screen.getByRole('button', { name: 'Загрузить сканы' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('пустой выбор файлов не ломает панель', () => {
    render(<CertificateScansPanel orderId='o1' targets={TARGETS} />);
    const input = screen.getByLabelText('Файлы сканов') as HTMLInputElement;
    fireEvent.change(input, { target: { files: null } });
    expect((screen.getByRole('button', { name: 'Загрузить сканы' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('позиция с уже загруженным сканом помечена в списке выбора', () => {
    render(<CertificateScansPanel orderId='o1' targets={TARGETS} />);
    pickFiles([pdf('Иванов.pdf')]);
    const select = screen.getByLabelText('Слушатель для файла Иванов.pdf');
    expect(select.textContent).toContain('(скан заменится)');
  });

  it('все файлы загрузились — сообщения об ошибке нет', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        results: [{ fileName: 'Иванов.pdf', ok: true, orderItemId: 'i1', documentId: 'd1' }]
      })
    });
    render(<CertificateScansPanel orderId='o1' targets={TARGETS} />);
    pickFiles([pdf('Иванов.pdf')]);
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить сканы' }));
    await waitFor(() => expect(success).toHaveBeenCalledWith('Загружено сканов: 1'));
    expect(error).not.toHaveBeenCalled();
  });

  it('удостоверение без номера показывается одним ФИО', () => {
    render(
      <CertificateScansPanel
        orderId='o1'
        targets={[{ ...TARGETS[0], certificateNumber: null }]}
      />
    );
    pickFiles([pdf('Иванов.pdf')]);
    const select = screen.getByLabelText('Слушатель для файла Иванов.pdf');
    expect(select.textContent).toContain('Иванов Иван');
    expect(select.textContent).not.toContain('·');
  });
});
