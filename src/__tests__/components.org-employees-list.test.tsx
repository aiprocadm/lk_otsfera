// @vitest-environment jsdom
/**
 * Поиск по сотрудникам организации (`У-63`, этап 4).
 *
 * Кнопки «Добавить сотрудника» здесь пока нет намеренно: её действие — `У-25`,
 * а сервис создания приходит этапом 5 (решение заказчика 09.08.2026).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { OrgEmployeesList, type OrgEmployeeRow } from '@/components/partner/org-employees-list';

const ROWS: OrgEmployeeRow[] = [
  { id: '1', roleInOrg: 'Инженер', user: { name: 'Иван Петров', email: 'ivan@example.com' } },
  { id: '2', roleInOrg: null, user: { name: 'Мария Сидорова', email: 'maria@example.com' } },
];

describe('OrgEmployeesList', () => {
  it('показывает всех сотрудников, пока поиск пуст', () => {
    render(<OrgEmployeesList rows={ROWS} />);
    expect(screen.getByText('Иван Петров')).toBeTruthy();
    expect(screen.getByText('Мария Сидорова')).toBeTruthy();
  });

  it('фильтрует по имени', () => {
    render(<OrgEmployeesList rows={ROWS} />);
    fireEvent.change(screen.getByTestId('org-employees-search'), { target: { value: 'мария' } });

    expect(screen.queryByText('Иван Петров')).toBeNull();
    expect(screen.getByText('Мария Сидорова')).toBeTruthy();
  });

  it('фильтрует по почте', () => {
    render(<OrgEmployeesList rows={ROWS} />);
    fireEvent.change(screen.getByTestId('org-employees-search'), { target: { value: 'ivan@' } });

    expect(screen.getByText('Иван Петров')).toBeTruthy();
    expect(screen.queryByText('Мария Сидорова')).toBeNull();
  });

  it('фильтрует по должности', () => {
    render(<OrgEmployeesList rows={ROWS} />);
    fireEvent.change(screen.getByTestId('org-employees-search'), { target: { value: 'инженер' } });

    expect(screen.getByText('Иван Петров')).toBeTruthy();
    expect(screen.queryByText('Мария Сидорова')).toBeNull();
  });

  it('§15: ничего не нашлось — объясняем, что делать, а не молчим', () => {
    render(<OrgEmployeesList rows={ROWS} />);
    fireEvent.change(screen.getByTestId('org-employees-search'), { target: { value: 'ыыы' } });

    expect(screen.getByText('Никого не нашлось.')).toBeTruthy();
    expect(screen.getByText(/очистите поле поиска/)).toBeTruthy();
  });

  it('пробелы вокруг запроса не мешают', () => {
    render(<OrgEmployeesList rows={ROWS} />);
    fireEvent.change(screen.getByTestId('org-employees-search'), { target: { value: '  Иван  ' } });

    expect(screen.getByText('Иван Петров')).toBeTruthy();
  });
});
