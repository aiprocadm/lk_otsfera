// @vitest-environment jsdom
/**
 * Этап 8 (PR-1) — RequisitesFields (DaData-автозаполнение) и RequisitesCard
 * (submit со скрытыми полями, canEdit=false, ошибки role=alert).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { autocompleteSpy } = vi.hoisted(() => ({ autocompleteSpy: vi.fn() }));
vi.mock('@/components/party/party-autocomplete', () => ({
  PartyAutocomplete: (props: {
    id?: string;
    name?: string;
    value: string;
    onChange: (t: string) => void;
    onSelect: (s: unknown) => void;
  }) => {
    autocompleteSpy(props);
    return (
      <div>
        <input id={props.id} name={props.name} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
        <button
          type="button"
          onClick={() =>
            props.onSelect({ name: 'ООО «ДаДата»', inn: '7707083893', kpp: '770701001', ogrn: '1027700132195', address: 'г. Москва' })
          }
        >
          stub-suggest
        </button>
      </div>
    );
  }
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { RequisitesFields, type RequisitesDefaults } from '@/components/requisites/requisites-fields';
import { RequisitesCard } from '@/components/requisites/requisites-card';

const DEFAULTS: RequisitesDefaults = {
  legalName: null,
  inn: null,
  kpp: null,
  ogrn: null,
  legalAddress: null,
  bankName: 'Т-Банк',
  bankAccount: null,
  corrAccount: null,
  bic: null,
  signerName: null,
  signerPosition: null,
  signerBasis: null
};

beforeEach(() => vi.clearAllMocks());

describe('RequisitesFields', () => {
  it('выбор DaData-подсказки автозаполняет название/ИНН/КПП/ОГРН/адрес; банк — из defaults', () => {
    render(<RequisitesFields defaults={DEFAULTS} idPrefix="t" />);
    fireEvent.click(screen.getByText('stub-suggest'));
    expect((screen.getByLabelText('ИНН') as HTMLInputElement).value).toBe('7707083893');
    expect((screen.getByLabelText('КПП') as HTMLInputElement).value).toBe('770701001');
    expect((screen.getByLabelText('ОГРН') as HTMLInputElement).value).toBe('1027700132195');
    expect((screen.getByLabelText('Юридический адрес') as HTMLInputElement).value).toBe('г. Москва');
    expect((screen.getByLabelText('Банк') as HTMLInputElement).value).toBe('Т-Банк');
  });

  it('ручной ввод работает без подсказок (деградация)', () => {
    render(<RequisitesFields defaults={DEFAULTS} idPrefix="t" />);
    fireEvent.change(screen.getByLabelText('ИНН'), { target: { value: '123' } });
    expect((screen.getByLabelText('ИНН') as HTMLInputElement).value).toBe('123');
  });
});

describe('RequisitesCard', () => {
  it('submit собирает поля + скрытые id; успех → toast', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(
      <RequisitesCard
        title="Реквизиты организации"
        description="desc"
        defaults={DEFAULTS}
        idPrefix="t"
        action={action}
        hidden={{ orgId: 'org-1' }}
      />
    );
    fireEvent.change(screen.getByLabelText('БИК'), { target: { value: '044525225' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    const fd = action.mock.calls[0]![0] as FormData;
    expect(fd.get('orgId')).toBe('org-1');
    expect(fd.get('bic')).toBe('044525225');
    expect(fd.get('bankName')).toBe('Т-Банк');
    expect(toastSuccess).toHaveBeenCalledWith('Реквизиты сохранены.');
  });

  it('ошибки с messages — списком role=alert; без messages — toast', async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, error: 'validation', messages: ['ИНН должен содержать 10 или 12 цифр'] });
    render(<RequisitesCard title="Т" description="d" defaults={DEFAULTS} idPrefix="t" action={action} />);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('ИНН'));

    action.mockResolvedValue({ ok: false, error: 'forbidden' });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось сохранить реквизиты.'));
  });

  it('canEdit=false — форма скрыта, подсказка о правах', () => {
    render(<RequisitesCard title="Т" description="d" defaults={DEFAULTS} idPrefix="t" action={vi.fn()} canEdit={false} />);
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    expect(screen.getByText(/администратор или руководитель/)).toBeTruthy();
  });

  it('children (доп. поля домена) попадают в форму', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(
      <RequisitesCard title="Т" description="d" defaults={DEFAULTS} idPrefix="t" action={action}>
        <input name="phone" defaultValue="+7" aria-label="Телефон" />
      </RequisitesCard>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect((action.mock.calls[0]![0] as FormData).get('phone')).toBe('+7');
  });
});
