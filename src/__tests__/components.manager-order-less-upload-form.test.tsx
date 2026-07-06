// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { ManagerOrderLessUploadForm } from '@/components/manager/manager-order-less-upload-form';

function makeFile(name: string): File {
  return new File(['x'], name, { type: 'application/pdf' });
}

// See components.organization-document-upload-form.test.tsx for the rationale.
function pickFile(input: HTMLInputElement, file: File): void {
  const implSymbol = Object.getOwnPropertySymbols(file)[0];
  const fileImpl = (file as any)[implSymbol];
  const fileList = input.files as unknown as File[];
  const flImplSymbol = Object.getOwnPropertySymbols(fileList)[0];
  const flImpl = (fileList as any)[flImplSymbol] as unknown[];
  flImpl.push(fileImpl);
  fireEvent.change(input);
}

describe('ManagerOrderLessUploadForm', () => {
  it('renders picker + file input', () => {
    const html = renderToString(
      <ManagerOrderLessUploadForm organizations={[{ id: 'o1', name: 'Org One' }]} partners={[{ id: 'p1', name: 'Partner One' }]} />
    );
    expect(html).toContain('Загрузить общий документ');
    expect(html).toContain('Org One');
    expect(html).toContain('name="file"');
  });

  it('renders accessible labels for all controls', () => {
    const html = renderToString(
      <ManagerOrderLessUploadForm organizations={[{ id: 'o1', name: 'Org One' }]} partners={[{ id: 'p1', name: 'Partner One' }]} />
    );
    expect(html).toContain('Тип контрагента');
    expect(html).toContain('Контрагент');
    expect(html).toContain('Тип документа');
    expect(html).toContain('Файл');
    // labels are associated via htmlFor / id pairs
    expect(html).toContain('for="orderless-counterparty-type"');
    expect(html).toContain('for="orderless-counterparty-id"');
    expect(html).toContain('for="orderless-doc-type"');
    expect(html).toContain('for="orderless-file"');
  });
});

describe('ManagerOrderLessUploadForm (interactive, jsdom)', () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.restoreAllMocks();
  });

  it('changing counterparty type to partner switches the options list to partners', () => {
    render(
      React.createElement(ManagerOrderLessUploadForm, {
        organizations: [{ id: 'o1', name: 'Org One' }],
        partners: [{ id: 'p1', name: 'Partner One' }]
      })
    );
    const typeSelect = document.getElementById('orderless-counterparty-type') as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: 'partner' } });
    expect(typeSelect.value).toBe('partner');
    expect(screen.getByText('Partner One')).toBeTruthy();
  });

  it('success path: submits, shows the success status message, and resets counterparty type to organization', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      React.createElement(ManagerOrderLessUploadForm, {
        organizations: [{ id: 'o1', name: 'Org One' }],
        partners: [{ id: 'p1', name: 'Partner One' }]
      })
    );

    const fileInput = document.getElementById('orderless-file') as HTMLInputElement;
    pickFile(fileInput, makeFile('doc.pdf'));

    fireEvent.click(screen.getByText('Загрузить'));

    await waitFor(() => expect(screen.getByText('Документ загружен')).toBeTruthy());
    const typeSelect = document.getElementById('orderless-counterparty-type') as HTMLSelectElement;
    expect(typeSelect.value).toBe('organization');
    expect(refresh).toHaveBeenCalled();
  });

  it('error path: renders the mapped alert text and does not show the success status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      React.createElement(ManagerOrderLessUploadForm, {
        organizations: [{ id: 'o1', name: 'Org One' }],
        partners: [{ id: 'p1', name: 'Partner One' }]
      })
    );
    const fileInput = document.getElementById('orderless-file') as HTMLInputElement;
    pickFile(fileInput, makeFile('doc.pdf'));
    fireEvent.click(screen.getByText('Загрузить'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Не удалось загрузить')).toBeTruthy();
    expect(screen.queryByText('Документ загружен')).toBeNull();
  });

  it('a second submit clears the prior success status (setOk(false) on submit)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      React.createElement(ManagerOrderLessUploadForm, {
        organizations: [{ id: 'o1', name: 'Org One' }],
        partners: [{ id: 'p1', name: 'Partner One' }]
      })
    );
    const fileInput = document.getElementById('orderless-file') as HTMLInputElement;
    pickFile(fileInput, makeFile('doc.pdf'));
    fireEvent.click(screen.getByText('Загрузить'));
    await waitFor(() => expect(screen.getByText('Документ загружен')).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Загрузить' })).toBeTruthy());

    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    pickFile(fileInput, makeFile('doc2.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }));

    await waitFor(() => expect(screen.queryByText('Документ загружен')).toBeNull());
  });
});
