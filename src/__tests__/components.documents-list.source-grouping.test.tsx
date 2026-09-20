// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentsList } from '@/components/partner/documents-list';
import type { OrgDocumentRow } from '@/lib/services/partner/orgDocuments';

/**
 * `У-253`, `У-258` — группировка страницы и колонка «источник».
 *
 * Группировка считается на УЖЕ полученной странице: иначе счётчики групп
 * разъедутся с постраничностью, и человек увидит «Счета: 40» там, где на
 * странице их шесть. Выбор запоминается в браузере — это привычка конкретного
 * сотрудника, и на сервер она не уходит вовсе.
 */
const base: OrgDocumentRow = {
  id: 'd1',
  name: 'a.pdf',
  type: 'invoice',
  direction: 'outgoing',
  signedAt: null,
  createdAt: new Date('2026-06-01T00:00:00Z'),
  size: 100,
  orderId: null,
  orderNumber: null,
  orderTitle: null,
  number: null,
  version: 1,
};

const ROWS: OrgDocumentRow[] = [
  { ...base, id: 'a', name: 'Счёт.pdf', type: 'invoice', createdAt: new Date('2026-06-01') },
  { ...base, id: 'b', name: 'Акт.pdf', type: 'act', createdAt: new Date('2025-11-01') },
  { ...base, id: 'c', name: 'Счёт2.pdf', type: 'invoice', createdAt: new Date('2025-02-01') },
];

describe('DocumentsList — группировка (У-253)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('без `grouping` переключателя нет', () => {
    render(<DocumentsList rows={ROWS} />);
    expect(screen.queryByText('Группировать:')).toBeNull();
  });

  it('по умолчанию группирует по заказу', () => {
    render(<DocumentsList rows={ROWS} grouping />);
    expect(screen.getByText('Группировать:')).toBeTruthy();
    // У всех строк заказа нет — одна группа «Без заказа» на три документа.
    expect(screen.getByText('Без заказа · 3')).toBeTruthy();
  });

  it('«по типу» раскладывает по типам и считает каждую полку', () => {
    render(<DocumentsList rows={ROWS} grouping />);
    fireEvent.click(screen.getByRole('button', { name: 'по типу' }));
    expect(screen.getByText('Счёт · 2')).toBeTruthy();
    expect(screen.getByText('Акт · 1')).toBeTruthy();
  });

  it('«по году» раскладывает по годам', () => {
    render(<DocumentsList rows={ROWS} grouping />);
    fireEvent.click(screen.getByRole('button', { name: 'по году' }));
    expect(screen.getByText('2026 год · 1')).toBeTruthy();
    expect(screen.getByText('2025 год · 2')).toBeTruthy();
  });

  it('выбор запоминается в браузере и восстанавливается', () => {
    const first = render(<DocumentsList rows={ROWS} grouping />);
    fireEvent.click(screen.getByRole('button', { name: 'по типу' }));
    expect(window.localStorage.getItem('documents.groupBy')).toBe('type');
    first.unmount();

    render(<DocumentsList rows={ROWS} grouping />);
    expect(screen.getByText('Счёт · 2')).toBeTruthy();
  });

  it('мусор в памяти браузера не ломает экран', () => {
    window.localStorage.setItem('documents.groupBy', 'по-алфавиту');
    render(<DocumentsList rows={ROWS} grouping />);
    // Остаёмся на умолчании, а не падаем и не показываем пустоту.
    expect(screen.getByText('Без заказа · 3')).toBeTruthy();
  });

  it('память браузера недоступна — экран работает, просто не запоминает выбор', () => {
    // В приватном окне и при запрете на данные сайта `localStorage` бросает на
    // ЧТЕНИИ и на ЗАПИСИ. Экран группировки из-за этого падать не должен: он
    // остаётся на умолчании и продолжает переключаться в этой сессии.
    const store = window.localStorage;
    const boom = () => {
      throw new Error('доступ к хранилищу запрещён');
    };
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { getItem: boom, setItem: boom, removeItem: boom, clear: boom },
    });
    try {
      render(<DocumentsList rows={ROWS} grouping />);
      expect(screen.getByText('Без заказа · 3')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'по типу' }));
      expect(screen.getByText('Счёт · 2')).toBeTruthy();
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: store });
    }
  });

  it('незнакомый тип документа подписывается своим кодом, а не пустой полкой', () => {
    // Тип приходит из 1С и может оказаться новым. Полка без названия выглядит
    // как поломка, а документы в ней — как потерянные.
    render(
      <DocumentsList
        rows={[{ ...base, id: 'x', name: 'Неизвестное.pdf', type: 'protocol' as never }]}
        grouping
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'по типу' }));
    expect(screen.getByText('protocol · 1')).toBeTruthy();
  });

  it('выбранная кнопка помечена для тех, кто не видит цвет', () => {
    render(<DocumentsList rows={ROWS} grouping />);
    const byType = screen.getByRole('button', { name: 'по типу' });
    expect(byType.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(byType);
    expect(screen.getByRole('button', { name: 'по типу' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });
});

describe('DocumentsList — источник документа (У-258)', () => {
  it('источник показывается, когда он известен', () => {
    render(<DocumentsList rows={[{ ...base, source: 'one_c' }]} />);
    expect(screen.getByText('Из 1С')).toBeTruthy();
  });

  it('у клиентских списков источника нет вовсе — строка о нём молчит', () => {
    // Поле не передаётся: заказчику знать, что его акт приехал из 1С, незачем.
    const { container } = render(<DocumentsList rows={[base]} />);
    expect(container.textContent).not.toContain('Из 1С');
    expect(container.textContent).not.toContain('Загружен');
  });
});
