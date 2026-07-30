// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { DocumentsList } from '@/components/partner/documents-list';
import type { OrgDocumentRow } from '@/lib/services/partner/orgDocuments';

/**
 * Этап 3 PR-2 (ФТ-6.6): бейдж «новый» у непросмотренных и группировка списка
 * по заказу (секции «Заказ №…» / «Без заказа»). Плоский режим — как раньше.
 */

const row = (over: Partial<OrgDocumentRow>): OrgDocumentRow => ({
  id: 'doc1',
  name: 'Договор.pdf',
  type: 'contract',
  direction: 'outgoing',
  signedAt: null,
  createdAt: new Date('2026-07-01'),
  size: 1024,
  orderId: null,
  orderNumber: null,
  orderTitle: null,
  ...over
});

describe('DocumentsList — бейдж «новый»', () => {
  it('бейдж только у id из newDocIds', () => {
    const { container } = render(
      <DocumentsList
        rows={[row({ id: 'a', name: 'A.pdf' }), row({ id: 'b', name: 'B.pdf' })]}
        newDocIds={['a']}
      />
    );
    const text = container.textContent!;
    expect(text).toContain('новый');
    const items = Array.from(container.querySelectorAll('li'));
    expect(items[0].textContent).toContain('новый');
    expect(items[1].textContent).not.toContain('новый');
  });

  it('без newDocIds бейджей нет (обратная совместимость)', () => {
    const { container } = render(<DocumentsList rows={[row({ id: 'a' })]} />);
    expect(container.textContent).not.toContain('новый');
  });
});

describe('DocumentsList — группировка по заказу', () => {
  const rows = [
    row({ id: '1', orderId: 'ord1', orderNumber: '42', orderTitle: 'Обучение' }),
    row({ id: '2', orderId: 'ord2', orderNumber: null, orderTitle: 'Без номера' }),
    row({ id: '3', orderId: 'ord1', orderNumber: '42', orderTitle: 'Обучение' }),
    row({ id: '4' }) // без заказа
  ];

  it('groupByOrder → секции по заказам в порядке появления + «Без заказа»; строка «Заказ: …» скрыта', () => {
    const { container } = render(<DocumentsList rows={rows} groupByOrder />);
    const headers = Array.from(container.querySelectorAll('h3')).map((h) => h.textContent);
    expect(headers).toEqual(['Заказ № 42', 'Заказ Без номера', 'Без заказа']);
    // Два документа ord1 в одной секции.
    const sections = container.querySelectorAll('section');
    expect(sections[0].querySelectorAll('li')).toHaveLength(2);
    expect(container.textContent).not.toContain('Заказ:');
    expect(container.textContent).not.toContain('Общий документ');
  });

  it('заказ без номера и без названия подписывается его идентификатором', () => {
    // Крайний случай импорта из 1С: заказ есть, а человекочитаемых полей нет.
    // Секция всё равно должна быть подписана, иначе документы уедут в безымянную
    // группу и их не найдут.
    const bare = [row({ id: '9', orderId: 'ord-bare', orderNumber: null, orderTitle: null })];
    const { container } = render(<DocumentsList rows={bare} groupByOrder />);
    expect(Array.from(container.querySelectorAll('h3')).map((h) => h.textContent)).toEqual([
      'Заказ ord-bare'
    ]);
  });

  it('плоский режим (по умолчанию): без секций, с подписью «Заказ: …» / «Общий документ»', () => {
    const { container } = render(<DocumentsList rows={rows} />);
    expect(container.querySelectorAll('section')).toHaveLength(0);
    expect(container.textContent).toContain('Заказ: 42');
    expect(container.textContent).toContain('Общий документ');
  });
});
