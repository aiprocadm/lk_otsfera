// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push, back, refresh } = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, back, refresh }) }));

import { LeadCreateForm } from '@/components/partner/lead-create-form';

const orgs = [
  { id: 'org1', name: 'ООО Ромашка' },
  { id: 'org2', name: 'ООО Вторая' }
];

function fillRequired() {
  fireEvent.change(screen.getByPlaceholderText('ООО «Ромашка»'), { target: { value: 'ООО Клиент' } });
  fireEvent.change(screen.getByPlaceholderText('Иван Петров'), { target: { value: 'Пётр Иванов' } });
  fireEvent.change(screen.getByPlaceholderText('Обучение электробезопасности, 25 чел.'), {
    target: { value: 'Нужно обучение' }
  });
}

describe('LeadCreateForm', () => {
  beforeEach(() => {
    push.mockClear();
    back.mockClear();
    refresh.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the org-picker select only when orgs is non-empty', () => {
    const { rerender } = render(React.createElement(LeadCreateForm, { orgs: [] }));
    expect(screen.queryByText('Организация из портфеля')).toBeNull();
    rerender(React.createElement(LeadCreateForm, { orgs }));
    expect(screen.getByText('Организация из портфеля')).toBeTruthy();
  });

  it('picking an org from the select prefills the client company name (only if empty)', () => {
    render(React.createElement(LeadCreateForm, { orgs }));
    const orgSelect = document.querySelector('select') as HTMLSelectElement;
    fireEvent.change(orgSelect, { target: { value: 'org1' } });
    expect((screen.getByPlaceholderText('ООО «Ромашка»') as HTMLInputElement).value).toBe('ООО Ромашка');
  });

  it('picking an org does not overwrite an already-typed client company name', () => {
    render(React.createElement(LeadCreateForm, { orgs }));
    fireEvent.change(screen.getByPlaceholderText('ООО «Ромашка»'), { target: { value: 'Уже введено' } });
    const orgSelect = document.querySelector('select') as HTMLSelectElement;
    fireEvent.change(orgSelect, { target: { value: 'org1' } });
    expect((screen.getByPlaceholderText('ООО «Ромашка»') as HTMLInputElement).value).toBe('Уже введено');
  });

  it('picking an unknown org id does not throw and leaves the company name untouched', () => {
    render(React.createElement(LeadCreateForm, { orgs }));
    const orgSelect = document.querySelector('select') as HTMLSelectElement;
    // simulate selecting a value not present in orgs (defensive branch org undefined)
    fireEvent.change(orgSelect, { target: { value: '' } });
    expect((screen.getByPlaceholderText('ООО «Ромашка»') as HTMLInputElement).value).toBe('');
  });

  it('the ИНН field strips non-digit characters and caps length via maxLength', () => {
    render(React.createElement(LeadCreateForm, { orgs: [] }));
    const innInput = screen.getByPlaceholderText('7707083893') as HTMLInputElement;
    fireEvent.change(innInput, { target: { value: '77-07/08a38 93' } });
    expect(innInput.value).toBe('7707083893');
  });

  it('toggling product-type chips adds and removes from the set', () => {
    render(React.createElement(LeadCreateForm, { orgs: [] }));
    const trainingChip = screen.getByText('Обучение');
    fireEvent.click(trainingChip);
    expect(trainingChip.className).toContain('bg-[#F97316]');
    fireEvent.click(trainingChip);
    expect(trainingChip.className).not.toContain('bg-[#F97316]');
  });

  it('submit is disabled until clientCompanyName, clientContactName and subject are filled', () => {
    render(React.createElement(LeadCreateForm, { orgs: [] }));
    const submit = screen.getByText('Создать заявку') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fillRequired();
    expect(submit.disabled).toBe(false);
  });

  it('a non-numeric estimatedAmount shows an inline validation error and keeps submit disabled', () => {
    render(React.createElement(LeadCreateForm, { orgs: [] }));
    fillRequired();
    fireEvent.change(screen.getByPlaceholderText('150000'), { target: { value: 'abc' } });
    expect(screen.getByText('Оценка суммы должна быть положительным числом')).toBeTruthy();
    expect((screen.getByText('Создать заявку') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a negative estimatedAmount shows the same inline validation error', () => {
    render(React.createElement(LeadCreateForm, { orgs: [] }));
    fillRequired();
    fireEvent.change(screen.getByPlaceholderText('150000'), { target: { value: '-500' } });
    expect(screen.getByText('Оценка суммы должна быть положительным числом')).toBeTruthy();
  });

  it('an empty estimatedAmount parses to null (no validation error, does not block submit)', () => {
    render(React.createElement(LeadCreateForm, { orgs: [] }));
    fillRequired();
    expect(screen.queryByText('Оценка суммы должна быть положительным числом')).toBeNull();
    expect((screen.getByText('Создать заявку') as HTMLButtonElement).disabled).toBe(false);
  });

  it('"Отмена" calls router.back()', () => {
    render(React.createElement(LeadCreateForm, { orgs: [] }));
    fireEvent.click(screen.getByText('Отмена'));
    expect(back).toHaveBeenCalled();
  });

  it('success path: POSTs the full payload (with a comma-decimal amount and product types), then router.push to the new lead', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'newlead' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LeadCreateForm, { orgs }));

    const orgSelect = document.querySelector('select') as HTMLSelectElement;
    fireEvent.change(orgSelect, { target: { value: 'org1' } });
    fillRequired();
    fireEvent.change(screen.getByPlaceholderText('7707083893'), { target: { value: '7707083893' } });
    fireEvent.change(screen.getByPlaceholderText('+7 ...'), { target: { value: '+7 999 000-00-00' } });
    fireEvent.change(screen.getByPlaceholderText('contact@company.ru'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('150000'), { target: { value: '150 000,50' } });
    fireEvent.click(screen.getByText('Обучение'));
    fireEvent.change(screen.getByPlaceholderText('Особенности заявки, сроки, контекст…'), { target: { value: 'заметка' } });

    fireEvent.click(screen.getByText('Создать заявку'));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/partner/leads/newlead'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/partner/leads',
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.organizationId).toBe('org1');
    expect(body.clientInn).toBe('7707083893');
    expect(body.clientContactPhone).toBe('+7 999 000-00-00');
    expect(body.clientContactEmail).toBe('a@b.com');
    expect(body.estimatedAmount).toBe(150000.5);
    expect(body.productType).toEqual(['training']);
    expect(body.notes).toBe('заметка');
  });

  it('omits optional fields as null when left blank (organizationId, clientInn, phone, email, notes)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'l2' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LeadCreateForm, { orgs: [] }));
    fillRequired();
    fireEvent.click(screen.getByText('Создать заявку'));

    await waitFor(() => expect(push).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.organizationId).toBeNull();
    expect(body.clientInn).toBeNull();
    expect(body.clientContactPhone).toBeNull();
    expect(body.clientContactEmail).toBeNull();
    expect(body.notes).toBeNull();
    expect(body.estimatedAmount).toBeNull();
  });

  it('error path: maps ORG_OUT_OF_SCOPE to a Russian message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'ORG_OUT_OF_SCOPE' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LeadCreateForm, { orgs: [] }));
    fillRequired();
    fireEvent.click(screen.getByText('Создать заявку'));

    expect(await screen.findByText('Эта организация недоступна в вашем scope')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
