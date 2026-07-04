// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { LeadAttachmentDropzone } from '@/components/partner/lead-attachment-dropzone';

function makeFile(name: string, opts: { type?: string; size?: number } = {}): File {
  const type = opts.type ?? 'application/pdf';
  const content = opts.size ? new Uint8Array(opts.size) : ['x'];
  return new File([content as never], name, { type });
}

describe('LeadAttachmentDropzone (SSR structural)', () => {
  it('renders the hidden file input and the idle prompt', () => {
    const html = renderToString(
      React.createElement(LeadAttachmentDropzone, { leadId: 'l1' })
    );
    expect(html).toContain('type="file"');
    expect(html).toContain('Перетащите файл или нажмите для выбора');
    expect(html).toContain('до <!-- -->200<!-- --> МБ');
  });
});

describe('LeadAttachmentDropzone (interactive, jsdom)', () => {
  beforeEach(() => {
    refresh.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dragOver sets the active border style, dragLeave clears it', () => {
    render(React.createElement(LeadAttachmentDropzone, { leadId: 'l1' }));
    const zone = screen.getByRole('button');
    fireEvent.dragOver(zone);
    expect(zone.className).toContain('border-[#F97316]');
    fireEvent.dragLeave(zone);
    expect(zone.className).not.toContain('bg-orange-50 hover:bg-orange-50');
  });

  it('clicking the dropzone triggers the hidden file input', () => {
    render(React.createElement(LeadAttachmentDropzone, { leadId: 'l1' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button'));
    expect(clickSpy).toHaveBeenCalled();
  });

  it('Enter keydown on the dropzone triggers the file input', () => {
    render(React.createElement(LeadAttachmentDropzone, { leadId: 'l1' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(clickSpy).toHaveBeenCalled();
  });

  it('Space keydown on the dropzone triggers the file input', () => {
    render(React.createElement(LeadAttachmentDropzone, { leadId: 'l1' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });
    expect(clickSpy).toHaveBeenCalled();
  });

  it('an unrelated keydown does not trigger the input', () => {
    render(React.createElement(LeadAttachmentDropzone, { leadId: 'l1' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    fireEvent.keyDown(screen.getByRole('button'), { key: 'a' });
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('file too large: shows the size error and does not call fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LeadAttachmentDropzone, { leadId: 'l1', maxSizeMb: 1 }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const bigFile = makeFile('big.pdf', { size: 2 * 1024 * 1024 });
    Object.defineProperty(input, 'files', { value: [bigFile], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText('Файл больше 1 МБ')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('unsupported mime type: shows the format error and does not call fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LeadAttachmentDropzone, { leadId: 'l1' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const badFile = makeFile('script.exe', { type: 'application/x-msdownload' });
    Object.defineProperty(input, 'files', { value: [badFile], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText('Поддерживаются PDF, JPEG, PNG, DOCX, XLSX')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('success path via drop: uploads and refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LeadAttachmentDropzone, { leadId: 'l1' }));
    const zone = screen.getByRole('button');
    const file = makeFile('doc.pdf');
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/partner/leads/l1/attachments',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('drop with no files does not call upload', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LeadAttachmentDropzone, { leadId: 'l1' }));
    const zone = screen.getByRole('button');
    fireEvent.drop(zone, { dataTransfer: { files: [] } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('413 response maps to the size-limit error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 413, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LeadAttachmentDropzone, { leadId: 'l1', maxSizeMb: 5 }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [makeFile('a.pdf')], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText('Файл больше 5 МБ')).toBeTruthy());
  });

  it('415 response maps to the unsupported-format error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 415, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LeadAttachmentDropzone, { leadId: 'l1' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [makeFile('a.pdf')], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText('Не поддерживаемый формат')).toBeTruthy());
  });

  it('403 response maps to the lead-not-editable error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LeadAttachmentDropzone, { leadId: 'l1' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [makeFile('a.pdf')], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText('Заявка не редактируется')).toBeTruthy());
  });

  it('other status codes render the server-provided error body message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LeadAttachmentDropzone, { leadId: 'l1' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [makeFile('a.pdf')], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy());
  });

  it('other status codes fall back to a generic message when body has no error field', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => null });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LeadAttachmentDropzone, { leadId: 'l1' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [makeFile('a.pdf')], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText('Ошибка загрузки: 500')).toBeTruthy());
  });

  it('network error (fetch rejects) renders the error message', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LeadAttachmentDropzone, { leadId: 'l1' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [makeFile('a.pdf')], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText('network down')).toBeTruthy());
  });

  it('non-Error rejection renders the generic network error message', async () => {
    const fetchMock = vi.fn().mockRejectedValue('weird');
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LeadAttachmentDropzone, { leadId: 'l1' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [makeFile('a.pdf')], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText('Ошибка сети')).toBeTruthy());
  });

  it('picking with no file (empty FileList) is a no-op', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LeadAttachmentDropzone, { leadId: 'l1' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    fireEvent.change(input);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
