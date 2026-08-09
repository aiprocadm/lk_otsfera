import { describe, it, expect } from 'vitest';
import { buildLeadBreadcrumbs, buildOrderBreadcrumbs } from '@/lib/navigation/breadcrumbs';

/**
 * Этап 11 PR-2 (ФТ-15.6) — цепочка заявка → лид → сделка → заказ.
 * Инвариант: последняя крошка — текущая страница и ссылки не имеет.
 */

function last<T>(arr: T[]): T {
  return arr[arr.length - 1];
}

describe('buildLeadBreadcrumbs', () => {
  it('лид из обращения: обращения → обращение → лид', () => {
    const crumbs = buildLeadBreadcrumbs({
      title: 'ООО «Ромашка»',
      sourceRequest: { id: 'r1', subject: 'Нужно обучение' },
    });
    expect(crumbs.map((c) => c.label)).toEqual(['Обращения', 'Нужно обучение', 'ООО «Ромашка»']);
    expect(last(crumbs).href).toBeNull();
  });

  it('лид без обращения ведёт от списка лидов', () => {
    const crumbs = buildLeadBreadcrumbs({ title: 'ООО «Ромашка»', sourceRequest: null });
    expect(crumbs.map((c) => c.label)).toEqual(['Лиды', 'ООО «Ромашка»']);
    expect(crumbs[0].href).toBe('/manager/leads');
  });

  it('пустые названия заменяются понятными словами', () => {
    const crumbs = buildLeadBreadcrumbs({
      title: '   ',
      sourceRequest: { id: 'r1', subject: null },
    });
    expect(crumbs.map((c) => c.label)).toEqual(['Обращения', 'Обращение', 'Лид']);
  });

  it('длинное название обрезается', () => {
    const crumbs = buildLeadBreadcrumbs({ title: 'я'.repeat(80), sourceRequest: null });
    expect(last(crumbs).label).toHaveLength(40);
    expect(last(crumbs).label.endsWith('…')).toBe(true);
  });
});

describe('buildOrderBreadcrumbs', () => {
  it('полная цепочка обращение → лид → сделка → заказ', () => {
    const crumbs = buildOrderBreadcrumbs({
      orderNumber: '2026-17',
      title: 'Обучение по ОТ',
      deal: {
        title: 'Сделка с Ромашкой',
        lead: {
          id: 'l1',
          title: 'ООО «Ромашка»',
          sourceRequest: { id: 'r1', subject: 'Нужно обучение' },
        },
      },
    });
    expect(crumbs.map((c) => c.label)).toEqual([
      'Обращения',
      'Нужно обучение',
      'ООО «Ромашка»',
      'Сделки',
      'Сделка с Ромашкой',
      'Заказ №2026-17',
    ]);
    expect(crumbs.find((c) => c.label === 'ООО «Ромашка»')?.href).toBe('/manager/leads/l1');
    expect(last(crumbs).href).toBeNull();
  });

  it('сделка без лида: сделки → сделка → заказ', () => {
    const crumbs = buildOrderBreadcrumbs({
      orderNumber: '5',
      title: 'Заказ',
      deal: { title: 'Прямая сделка', lead: null },
    });
    expect(crumbs.map((c) => c.label)).toEqual(['Сделки', 'Прямая сделка', 'Заказ №5']);
  });

  it('лид без обращения: лид → сделка → заказ, крошек обращения нет', () => {
    const crumbs = buildOrderBreadcrumbs({
      orderNumber: null,
      title: 'Разработка документов',
      deal: { title: 'Сделка', lead: { id: 'l2', title: 'Лид-2', sourceRequest: null } },
    });
    expect(crumbs.map((c) => c.label)).toEqual([
      'Лид-2',
      'Сделки',
      'Сделка',
      'Разработка документов',
    ]);
  });

  it('заказ без сделки: заказы → заказ', () => {
    const crumbs = buildOrderBreadcrumbs({ orderNumber: '9', title: 'Заказ', deal: null });
    expect(crumbs).toEqual([
      { label: 'Заказы', href: '/manager/orders' },
      { label: 'Заказ №9', href: null },
    ]);
  });

  it('без номера подписью становится название заказа', () => {
    const crumbs = buildOrderBreadcrumbs({ orderNumber: null, title: 'Аудит', deal: null });
    expect(last(crumbs).label).toBe('Аудит');
  });

  it('без номера и без названия — общее слово', () => {
    const crumbs = buildOrderBreadcrumbs({ orderNumber: null, title: null, deal: null });
    expect(last(crumbs).label).toBe('Заказ');
  });
});
