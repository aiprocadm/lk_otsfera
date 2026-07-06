// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { LeadAttachmentsList, type LeadAttachmentRowVM } from '@/components/partner/lead-attachments-list';

function makeRow(overrides: Partial<LeadAttachmentRowVM> = {}): LeadAttachmentRowVM {
  return {
    id: 'a1',
    name: 'file.pdf',
    size: 500,
    mimeType: 'application/pdf',
    createdAt: '2026-01-01T10:00:00Z',
    createdByUserId: 'u1',
    createdByUserName: 'Иван',
    ...overrides
  };
}

describe('LeadAttachmentsList (SSR structural)', () => {
  it('renders the empty message when there are no rows', () => {
    const html = renderToString(
      React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [], canDelete: true, currentUserId: 'u1', isPartnerAdmin: false })
    );
    expect(html).toContain('Пока нет вложений');
  });

  it('renders a PDF row with size, date and author', () => {
    const html = renderToString(
      React.createElement(LeadAttachmentsList, {
        leadId: 'l1', rows: [makeRow()], canDelete: false, currentUserId: 'u2', isPartnerAdmin: false
      })
    );
    expect(html).toContain('PDF');
    expect(html).toContain('file.pdf');
    expect(html).toContain('Иван');
    expect(html).toContain('href="/api/partner/leads/l1/attachments/a1/download"');
  });

  it('recognises image, docx and xlsx mime icons, and an unknown mime falls back to FILE', () => {
    const rowsHtml = [
      renderToString(React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [makeRow({ mimeType: 'image/png' })], canDelete: false, currentUserId: 'u2', isPartnerAdmin: false })),
      renderToString(React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [makeRow({ mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })], canDelete: false, currentUserId: 'u2', isPartnerAdmin: false })),
      renderToString(React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [makeRow({ mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })], canDelete: false, currentUserId: 'u2', isPartnerAdmin: false })),
      renderToString(React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [makeRow({ mimeType: 'text/plain' })], canDelete: false, currentUserId: 'u2', isPartnerAdmin: false }))
    ];
    expect(rowsHtml[0]).toContain('IMG');
    expect(rowsHtml[1]).toContain('DOC');
    expect(rowsHtml[2]).toContain('XLS');
    expect(rowsHtml[3]).toContain('FILE');
  });

  it('formats sizes in bytes, KB and MB', () => {
    const bytesHtml = renderToString(React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [makeRow({ size: 500 })], canDelete: false, currentUserId: 'u2', isPartnerAdmin: false }));
    const kbHtml = renderToString(React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [makeRow({ size: 2048 })], canDelete: false, currentUserId: 'u2', isPartnerAdmin: false }));
    const mbHtml = renderToString(React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [makeRow({ size: 5 * 1024 * 1024 })], canDelete: false, currentUserId: 'u2', isPartnerAdmin: false }));
    expect(bytesHtml).toContain('500 Б');
    expect(kbHtml).toContain('2.0 КБ');
    expect(mbHtml).toContain('5.0 МБ');
  });

  it('omits the author suffix when createdByUserName is null', () => {
    const html = renderToString(
      React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [makeRow({ createdByUserName: null })], canDelete: false, currentUserId: 'u2', isPartnerAdmin: false })
    );
    expect(html).not.toContain('· <!-- -->Иван');
  });

  it('shows the delete button when canDelete and isPartnerAdmin', () => {
    const html = renderToString(
      React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [makeRow({ createdByUserId: 'someone-else' })], canDelete: true, currentUserId: 'u2', isPartnerAdmin: true })
    );
    expect(html).toContain('Удалить вложение');
  });

  it('shows the delete button when canDelete and the current user is the uploader', () => {
    const html = renderToString(
      React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [makeRow({ createdByUserId: 'u2' })], canDelete: true, currentUserId: 'u2', isPartnerAdmin: false })
    );
    expect(html).toContain('Удалить вложение');
  });

  it('hides the delete button when the current user is neither admin nor uploader', () => {
    const html = renderToString(
      React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [makeRow({ createdByUserId: 'someone-else' })], canDelete: true, currentUserId: 'u2', isPartnerAdmin: false })
    );
    expect(html).not.toContain('Удалить вложение');
  });

  it('hides the delete button entirely when canDelete is false', () => {
    const html = renderToString(
      React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [makeRow()], canDelete: false, currentUserId: 'u1', isPartnerAdmin: true })
    );
    expect(html).not.toContain('Удалить вложение');
  });
});

describe('LeadAttachmentsList (interactive, jsdom)', () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.stubGlobal('confirm', vi.fn(() => true));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cancelling the confirm dialog does not call delete', () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [makeRow()], canDelete: true, currentUserId: 'u1', isPartnerAdmin: true })
    );
    fireEvent.click(screen.getByLabelText('Удалить вложение'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('success path: DELETE request then router.refresh()', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [makeRow()], canDelete: true, currentUserId: 'u1', isPartnerAdmin: true })
    );
    fireEvent.click(screen.getByLabelText('Удалить вложение'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/partner/leads/l1/attachments/a1', { method: 'DELETE' });
  });

  it('server error response with a body error field renders it verbatim', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'forbidden' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [makeRow()], canDelete: true, currentUserId: 'u1', isPartnerAdmin: true })
    );
    fireEvent.click(screen.getByLabelText('Удалить вложение'));
    await waitFor(() => expect(screen.getByText('forbidden')).toBeTruthy());
  });

  it('server error response with no parseable body falls back to the generic status message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('bad json'); } });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [makeRow()], canDelete: true, currentUserId: 'u1', isPartnerAdmin: true })
    );
    fireEvent.click(screen.getByLabelText('Удалить вложение'));
    await waitFor(() => expect(screen.getByText('Ошибка удаления: 500')).toBeTruthy());
  });

  it('network error (fetch throws an Error) renders the Error message', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'));
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [makeRow()], canDelete: true, currentUserId: 'u1', isPartnerAdmin: true })
    );
    fireEvent.click(screen.getByLabelText('Удалить вложение'));
    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy());
  });

  it('network error (fetch rejects a non-Error) renders the generic network error message', async () => {
    const fetchMock = vi.fn().mockRejectedValue('weird');
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(LeadAttachmentsList, { leadId: 'l1', rows: [makeRow()], canDelete: true, currentUserId: 'u1', isPartnerAdmin: true })
    );
    fireEvent.click(screen.getByLabelText('Удалить вложение'));
    await waitFor(() => expect(screen.getByText('Ошибка сети')).toBeTruthy());
  });
});
