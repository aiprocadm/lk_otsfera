// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { DocumentsList } from '@/components/partner/documents-list';
import type { OrgDocumentRow } from '@/lib/services/partner/orgDocuments';

const base: OrgDocumentRow = {
  id: 'd1', name: 'gen.pdf', type: 'other', direction: 'outgoing',
  signedAt: null, createdAt: new Date('2026-06-01'), size: 100,
  orderId: null, orderNumber: null, orderTitle: null
};

describe('DocumentsList order-less label', () => {
  it('shows «Общий документ» when order fields are null', () => {
    const html = renderToString(<DocumentsList rows={[{ ...base, orderId: null, orderNumber: null, orderTitle: null }] as never} />);
    expect(html).toContain('Общий документ');
  });
  it('shows order reference for order-bound docs', () => {
    const html = renderToString(<DocumentsList rows={[{ ...base, orderId: 'o1', orderNumber: '№42', orderTitle: 'T' }] as never} />);
    expect(html).toContain('№42');
  });
  it('falls back to orderTitle when orderNumber is null but the doc is order-bound', () => {
    const html = renderToString(<DocumentsList rows={[{ ...base, orderId: 'o1', orderNumber: null, orderTitle: 'Обучение ОТ' }] as never} />);
    expect(html).toContain('Обучение ОТ');
  });
});

describe('DocumentsList — empty and formatting', () => {
  it('renders the empty state when rows is empty', () => {
    const html = renderToString(<DocumentsList rows={[]} />);
    expect(html).toContain('Документов по выбранному фильтру нет');
  });

  it('formats sizes: null/0 as em-dash, sub-1024KB as КБ, larger as МБ', () => {
    const nullSize = renderToString(<DocumentsList rows={[{ ...base, size: null }]} />);
    const zeroSize = renderToString(<DocumentsList rows={[{ ...base, size: 0 }]} />);
    const kb = renderToString(<DocumentsList rows={[{ ...base, size: 2048 }]} />);
    const mb = renderToString(<DocumentsList rows={[{ ...base, size: 5 * 1024 * 1024 }]} />);
    expect(nullSize).toContain('—');
    expect(zeroSize).toContain('—');
    expect(kb).toContain('2 КБ');
    expect(mb).toContain('5.0 МБ');
  });

  it('shows the incoming/outgoing direction label with distinct styling', () => {
    const incoming = renderToString(<DocumentsList rows={[{ ...base, direction: 'incoming' }]} />);
    const outgoing = renderToString(<DocumentsList rows={[{ ...base, direction: 'outgoing' }]} />);
    expect(incoming).toContain('Входящий');
    expect(incoming).toContain('text-blue-700');
    expect(outgoing).toContain('Исходящий');
  });

  it('shows the "подписан" badge only when signedAt is set', () => {
    const signed = renderToString(<DocumentsList rows={[{ ...base, signedAt: new Date('2026-06-02') }]} />);
    const unsigned = renderToString(<DocumentsList rows={[{ ...base, signedAt: null }]} />);
    expect(signed).toContain('подписан');
    expect(unsigned).not.toContain('подписан');
  });

  it('renders every document type label and falls back to the raw type string for unknown types', () => {
    const types: OrgDocumentRow['type'][] = ['contract', 'extra_agreement', 'invoice', 'act', 'waybill', 'certificate', 'report', 'commission_statement', 'other'];
    for (const type of types) {
      const html = renderToString(<DocumentsList rows={[{ ...base, type }]} />);
      expect(html).toBeTruthy();
    }
    const unknownHtml = renderToString(<DocumentsList rows={[{ ...base, type: 'weird' as OrgDocumentRow['type'] }]} />);
    expect(unknownHtml).toContain('weird');
  });

  it('shows the 200-row cutoff notice only when rows.length === 200', () => {
    const rows200 = Array.from({ length: 200 }, (_, i) => ({ ...base, id: `d${i}` }));
    const rows199 = Array.from({ length: 199 }, (_, i) => ({ ...base, id: `d${i}` }));
    const html200 = renderToString(<DocumentsList rows={rows200} />);
    const html199 = renderToString(<DocumentsList rows={rows199} />);
    expect(html200).toContain('Показаны первые 200 документов');
    expect(html199).not.toContain('Показаны первые 200 документов');
  });

  it('icon mapping: contract/extra_agreement -> 📜, invoice/act/waybill -> 🧾, certificate -> 🎖, report -> 📊, commission_statement -> 💼, other/unknown -> 📄', () => {
    const iconFor = (type: string) => renderToString(<DocumentsList rows={[{ ...base, type: type as OrgDocumentRow['type'] }]} />);
    expect(iconFor('contract')).toContain('📜');
    expect(iconFor('extra_agreement')).toContain('📜');
    expect(iconFor('invoice')).toContain('🧾');
    expect(iconFor('act')).toContain('🧾');
    expect(iconFor('waybill')).toContain('🧾');
    expect(iconFor('certificate')).toContain('🎖');
    expect(iconFor('report')).toContain('📊');
    expect(iconFor('commission_statement')).toContain('💼');
    expect(iconFor('other')).toContain('📄');
    expect(iconFor('unknown_type')).toContain('📄');
  });
});

describe('DocumentsList — download (interactive, jsdom)', () => {
  let clickSpy: ReturnType<typeof vi.fn>;
  let appendSpy: ReturnType<typeof vi.fn>;
  let removeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}) as unknown as ReturnType<typeof vi.fn>;
    appendSpy = vi.spyOn(document.body, 'appendChild') as unknown as ReturnType<typeof vi.fn>;
    removeSpy = vi.spyOn(HTMLAnchorElement.prototype, 'remove').mockImplementation(() => {}) as unknown as ReturnType<typeof vi.fn>;
  });
  afterEach(() => {
    clickSpy.mockRestore();
    appendSpy.mockRestore();
    removeSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('success path: POSTs the default endpoint, creates+clicks a download link, then removes it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ downloadUrl: 'https://s3/x' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<DocumentsList rows={[base]} />);
    fireEvent.click(screen.getByText('Скачать'));

    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/documents/d1/download', { method: 'POST' });
    expect(appendSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
  });

  it('respects a custom downloadEndpointBase and downloadEndpointQuery', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ downloadUrl: 'https://s3/y' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<DocumentsList rows={[base]} downloadEndpointBase='/api/organization/documents' downloadEndpointQuery='?orgId=g1' />);
    fireEvent.click(screen.getByText('Скачать'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/organization/documents/d1/download?orgId=g1', { method: 'POST' });
  });

  it('shows the busy label while downloading, then resets after completion', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    render(<DocumentsList rows={[base]} />);
    fireEvent.click(screen.getByText('Скачать'));

    await waitFor(() => expect(screen.getByText('Готовим…')).toBeTruthy());
    resolveFetch({ ok: true, json: async () => ({ downloadUrl: 'https://s3/z' }) });
    await waitFor(() => expect(screen.getByText('Скачать')).toBeTruthy());
  });

  it('server error response shows the error banner and does not click a link', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);
    render(<DocumentsList rows={[base]} />);
    fireEvent.click(screen.getByText('Скачать'));

    await waitFor(() => expect(screen.getByText('Не удалось получить ссылку для скачивания')).toBeTruthy());
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('410 (quarantined) response shows the quarantine message instead of the generic one', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 410 });
    vi.stubGlobal('fetch', fetchMock);
    render(<DocumentsList rows={[base]} />);
    fireEvent.click(screen.getByText('Скачать'));

    await waitFor(() =>
      expect(screen.getByText('Файл в карантине: не прошёл антивирусную проверку.')).toBeTruthy()
    );
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('missing downloadUrl in the response body shows the retry message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<DocumentsList rows={[base]} />);
    fireEvent.click(screen.getByText('Скачать'));

    await waitFor(() => expect(screen.getByText('Ссылка не вернулась — попробуйте ещё раз')).toBeTruthy());
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('a prior error banner clears on the next download attempt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ downloadUrl: 'https://s3/again' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<DocumentsList rows={[base]} />);
    fireEvent.click(screen.getByText('Скачать'));
    await waitFor(() => expect(screen.getByText('Не удалось получить ссылку для скачивания')).toBeTruthy());

    fireEvent.click(screen.getByText('Скачать'));
    await waitFor(() => expect(screen.queryByText('Не удалось получить ссылку для скачивания')).toBeNull());
  });
});
