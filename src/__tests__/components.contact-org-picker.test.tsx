// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Организация в форме контакта (этап 6 ТЗ 13.10.2026, `У-309`): поиск по
 * названию или ИНН среди своих и «Создать новую» прямо из формы. Новая —
 * сразу выбрана; уже существующая своя — выбирается вместо дубля.
 */
const { createOrganizationAction } = vi.hoisted(() => ({ createOrganizationAction: vi.fn() }));
vi.mock('@/server-actions/organizations/create', () => ({ createOrganizationAction }));

import { ContactOrgPicker } from '@/components/manager/contacts/contact-org-picker';

const OPTIONS = [
  { id: 'a', name: 'Альфа', inn: '7701000001' },
  { id: 'b', name: 'Бета' },
  { id: 'g', name: 'Гамма', inn: null },
];

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ContactOrgPicker
        idPrefix="t"
        options={OPTIONS}
        value={value}
        onChange={setValue}
        disabled={false}
      />
      <span data-testid="value">{value}</span>
    </>
  );
}

const optionTexts = () =>
  [...(document.getElementById('t-org') as HTMLSelectElement).options].map((o) => o.textContent);
const search = (q: string) =>
  fireEvent.change(screen.getByLabelText('Найти организацию по названию или ИНН'), {
    target: { value: q },
  });

beforeEach(() => vi.clearAllMocks());

describe('ContactOrgPicker', () => {
  it('без поиска — все свои, ИНН рядом с названием; выбор меняет значение', () => {
    render(<Harness />);
    expect(optionTexts()).toEqual(['Без организации', 'Альфа · ИНН 7701000001', 'Бета', 'Гамма']);
    fireEvent.change(document.getElementById('t-org')!, { target: { value: 'b' } });
    expect(screen.getByTestId('value').textContent).toBe('b');
  });

  it('поиск по названию и по началу ИНН; выбранная остаётся в списке', () => {
    render(<Harness initial="g" />);
    search('бет');
    expect(optionTexts()).toEqual(['Без организации', 'Бета', 'Гамма']);
    search('7701');
    expect(optionTexts()).toEqual(['Без организации', 'Альфа · ИНН 7701000001', 'Гамма']);
  });

  it('ничего не нашлось — подсказка создать; «Создать новую» подставляет запрос в название', () => {
    render(<Harness />);
    search('Дельта');
    expect(screen.getByText('Среди ваших организаций такой нет — создайте новую.')).toBeTruthy();
    fireEvent.click(screen.getByText('Нет в списке? Создать новую'));
    expect((screen.getByLabelText('Название новой организации') as HTMLInputElement).value).toBe(
      'Дельта'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByLabelText('Название новой организации')).toBeNull();
  });

  it('создать без названия — подсказка, сервер не зовём', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Нет в списке? Создать новую'));
    fireEvent.click(screen.getByRole('button', { name: 'Создать организацию' }));
    expect(screen.getByRole('status').textContent).toBe('Укажите название новой организации.');
    expect(createOrganizationAction).not.toHaveBeenCalled();
  });

  it('создана — появилась в списке и выбрана', async () => {
    createOrganizationAction.mockResolvedValue({ ok: true, organizationId: 'd', name: 'Дельта' });
    render(<Harness />);
    fireEvent.click(screen.getByText('Нет в списке? Создать новую'));
    fireEvent.change(screen.getByLabelText('Название новой организации'), {
      target: { value: ' Дельта ' },
    });
    fireEvent.change(screen.getByLabelText('ИНН (если знаете)'), {
      target: { value: '7702000002' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать организацию' }));
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('d'));
    expect(createOrganizationAction).toHaveBeenCalledWith({ name: 'Дельта', inn: '7702000002' });
    expect(optionTexts()).toContain('Дельта · ИНН 7702000002');
    expect(screen.getByRole('status').textContent).toBe('Организация «Дельта» создана и выбрана.');
  });

  it('создана без ИНН — в списке просто название', async () => {
    createOrganizationAction.mockResolvedValue({ ok: true, organizationId: 'e', name: 'Эпсилон' });
    render(<Harness />);
    fireEvent.click(screen.getByText('Нет в списке? Создать новую'));
    fireEvent.change(screen.getByLabelText('Название новой организации'), {
      target: { value: 'Эпсилон' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать организацию' }));
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('e'));
    expect(createOrganizationAction).toHaveBeenCalledWith({ name: 'Эпсилон' });
    expect(optionTexts()).toContain('Эпсилон');
  });

  it('такая уже есть среди своих — выбираем её вместо дубля', async () => {
    createOrganizationAction.mockResolvedValue({
      ok: false,
      error: 'org_exists',
      organizationId: 'b',
    });
    render(<Harness />);
    fireEvent.click(screen.getByText('Нет в списке? Создать новую'));
    fireEvent.change(screen.getByLabelText('Название новой организации'), {
      target: { value: 'ООО Бета' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать организацию' }));
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('b'));
    expect(screen.getByRole('status').textContent).toBe(
      'Такая организация уже есть — выбрали «Бета».'
    );
  });

  it('«уже есть», но не среди своих, и прочие отказы — русская строка, выбор не меняется', async () => {
    createOrganizationAction.mockResolvedValue({
      ok: false,
      error: 'org_exists',
      organizationId: 'чужая',
    });
    render(<Harness />);
    fireEvent.click(screen.getByText('Нет в списке? Создать новую'));
    fireEvent.change(screen.getByLabelText('Название новой организации'), {
      target: { value: 'Икс' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать организацию' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Такая организация уже есть.')
    );
    createOrganizationAction.mockResolvedValue({ ok: false, error: 'org_in_other_company' });
    fireEvent.click(screen.getByRole('button', { name: 'Создать организацию' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('ведётся другой компанией')
    );
    expect(screen.getByTestId('value').textContent).toBe('');
  });
});
