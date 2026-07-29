// @vitest-environment jsdom
/**
 * §11 ТЗ v0.5 (этап 1 PR-4) — карточка документа.
 *
 * Отдельно проверяется поведение с заражённым файлом: карточка открывается,
 * но скачивание закрыто — это разные сигналы (CLAUDE.md §10: 410 Gone, а не 404).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DocumentDetailView, fmtSize } from '@/components/documents/document-detail-view';
import type { DocumentDetail } from '@/lib/services/documents/detail';

function doc(over: Partial<DocumentDetail> = {}): DocumentDetail {
  return {
    id: 'doc1',
    name: 'Счёт №5',
    type: 'invoice',
    direction: 'outgoing',
    number: 'С-2026-5',
    version: 2,
    size: 2048,
    mimeType: 'application/pdf',
    scanStatus: 'clean',
    scanReason: null,
    signedAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    uploadedByName: 'Иванов',
    order: { id: 'ord1', title: 'Заказ', orderNumber: 'ON-1' },
    counterparty: { type: 'organization', id: 'org1', name: 'ООО Ромашка' },
    ...over
  };
}

describe('DocumentDetailView — сведения', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('шапка: имя, русский тип и направление', () => {
    render(<DocumentDetailView document={doc()} backHref='/admin/documents' />);
    expect(screen.getByText('Счёт №5')).toBeTruthy();
    expect(screen.getByText(/Счёт · Исходящий/)).toBeTruthy();
  });

  it('неизвестный тип и направление показываются как есть, а не пустотой', () => {
    render(
      <DocumentDetailView
        document={doc({ type: 'weird', direction: 'sideways' })}
        backHref='/admin/documents'
      />
    );
    expect(screen.getByText(/weird · sideways/)).toBeTruthy();
  });

  it('ссылка «назад» ведёт в список своего кабинета', () => {
    render(<DocumentDetailView document={doc()} backHref='/partner/documents' />);
    expect(screen.getByRole('link', { name: '← Документы' }).getAttribute('href')).toBe(
      '/partner/documents'
    );
  });

  it('заказ — ссылка в свой кабинет, если база передана', () => {
    render(
      <DocumentDetailView
        document={doc()}
        backHref='/manager/documents'
        orderHrefBase='/manager/orders'
      />
    );
    expect(screen.getByRole('link', { name: 'ON-1' }).getAttribute('href')).toBe(
      '/manager/orders/ord1'
    );
  });

  it('без базы заказа — просто текст, без битой ссылки', () => {
    render(<DocumentDetailView document={doc()} backHref='/admin/documents' />);
    expect(screen.queryByRole('link', { name: 'ON-1' })).toBeNull();
    expect(screen.getByText('ON-1')).toBeTruthy();
  });

  it('у заказа без номера показывается название', () => {
    render(
      <DocumentDetailView
        document={doc({ order: { id: 'o2', title: 'Обучение ОТ', orderNumber: null } })}
        backHref='/admin/documents'
        orderHrefBase='/admin/orders'
      />
    );
    expect(screen.getByRole('link', { name: 'Обучение ОТ' })).toBeTruthy();
  });

  it('общий документ подписан как «вне заказа»', () => {
    render(<DocumentDetailView document={doc({ order: null })} backHref='/admin/documents' />);
    expect(screen.getByText('Общий документ (вне заказа)')).toBeTruthy();
  });

  it('пустые номер, дата подписи и загрузивший дают прочерк', () => {
    render(
      <DocumentDetailView
        document={doc({ number: null, signedAt: null, uploadedByName: null })}
        backHref='/admin/documents'
      />
    );
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('дата подписи выводится, когда есть', () => {
    render(
      <DocumentDetailView
        document={doc({ signedAt: new Date('2026-07-15T00:00:00Z') })}
        backHref='/admin/documents'
      />
    );
    expect(screen.getByText('15.07.2026')).toBeTruthy();
  });

  it('статус антивируса: чисто / идёт проверка', () => {
    const { rerender } = render(
      <DocumentDetailView document={doc()} backHref='/admin/documents' />
    );
    expect(screen.getByText('чисто')).toBeTruthy();

    rerender(
      <DocumentDetailView document={doc({ scanStatus: 'pending' })} backHref='/admin/documents' />
    );
    expect(screen.getByText('идёт проверка')).toBeTruthy();
  });

  it('неизвестный тип контрагента подписывается нейтрально, пустое имя — прочерком', () => {
    render(
      <DocumentDetailView
        document={doc({ counterparty: { type: 'unknown', id: 'x', name: null } })}
        backHref='/admin/documents'
      />
    );
    expect(screen.getByText('Контрагент')).toBeTruthy();
  });

  it('без базы заказа и без номера показывается название заказа', () => {
    render(
      <DocumentDetailView
        document={doc({ order: { id: 'o3', title: 'Разработка документов', orderNumber: null } })}
        backHref='/admin/documents'
      />
    );
    expect(screen.getByText('Разработка документов')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Разработка документов' })).toBeNull();
  });

  it('секция полей рендерится дочерним элементом', () => {
    render(
      <DocumentDetailView document={doc()} backHref='/admin/documents'>
        <div data-testid='fields'>поля</div>
      </DocumentDetailView>
    );
    expect(screen.getByTestId('fields')).toBeTruthy();
  });
});

describe('DocumentDetailView — заражённый файл', () => {
  it('карточка открывается, но скачивание закрыто и есть предупреждение', () => {
    render(
      <DocumentDetailView
        document={doc({ scanStatus: 'infected', scanReason: 'Eicar-Test' })}
        backHref='/admin/documents'
      />
    );
    expect(screen.getByText(/Файл заблокирован антивирусом/)).toBeTruthy();
    expect(screen.getByText(/Eicar-Test/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Скачать файл' })).toBeNull();
    expect(screen.getByText('заблокирован')).toBeTruthy();
  });

  it('без причины блокировки предупреждение всё равно показывается', () => {
    render(
      <DocumentDetailView
        document={doc({ scanStatus: 'infected', scanReason: null })}
        backHref='/admin/documents'
      />
    );
    expect(screen.getByText(/Файл заблокирован антивирусом/)).toBeTruthy();
  });
});

describe('DocumentDetailView — скачивание', () => {
  beforeEach(() => {
    vi.stubGlobal('open', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('успех: запрашивает ссылку у роута и открывает её', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ downloadUrl: 'https://s3.local/file.pdf' })
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DocumentDetailView document={doc()} backHref='/admin/documents' />);
    fireEvent.click(screen.getByRole('button', { name: 'Скачать файл' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/documents/doc1/download', { method: 'POST' })
    );
    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith(
        'https://s3.local/file.pdf',
        '_blank',
        'noopener,noreferrer'
      )
    );
  });

  it('410 от роута: отдельное сообщение про карантин, а не общая ошибка', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 410 }));

    render(<DocumentDetailView document={doc()} backHref='/admin/documents' />);
    fireEvent.click(screen.getByRole('button', { name: 'Скачать файл' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('заблокирован антивирусом')
    );
    expect(window.open).not.toHaveBeenCalled();
  });

  it('прочая ошибка: предлагает повторить', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }));

    render(<DocumentDetailView document={doc()} backHref='/admin/documents' />);
    fireEvent.click(screen.getByRole('button', { name: 'Скачать файл' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Попробуйте ещё раз')
    );
  });
});

describe('fmtSize', () => {
  it('пусто и ноль дают прочерк', () => {
    expect(fmtSize(null)).toBe('—');
    expect(fmtSize(0)).toBe('—');
  });

  it('килобайты и мегабайты', () => {
    expect(fmtSize(2048)).toBe('2 КБ');
    expect(fmtSize(5 * 1024 * 1024)).toBe('5.0 МБ');
  });
});
