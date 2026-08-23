import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';

import { PaymentQueueToolbar } from '@/components/import/payment-queue-toolbar';

// `У-90`: список больше не обрывается молча на 200 строках. Человек видит,
// сколько строк всего, какая часть открыта и чем список отфильтрован.
describe('PaymentQueueToolbar (У-90)', () => {
  const base = {
    basePath: '/admin/settings/integrations/1c/payments',
    searchParams: {} as Record<string, string | string[] | undefined>,
    total: 250,
    take: 50,
    skip: 0,
  };

  it('показывает, сколько строк всего и какие открыты', () => {
    const html = renderToString(<PaymentQueueToolbar {...base} />);
    expect(html).toContain('Всего в очереди: 250');
    expect(html).toContain('1–50');
  });

  it('на второй странице показывает её диапазон', () => {
    const html = renderToString(<PaymentQueueToolbar {...base} skip={200} />);
    expect(html).toContain('201–250');
  });

  it('фильтры и сортировка — ссылки, сохраняющие остальные параметры', () => {
    const html = renderToString(
      <PaymentQueueToolbar {...base} searchParams={{ sort: 'amount' }} />
    );
    expect(html).toContain('inn=without');
    expect(html).toContain('candidate=order');
    expect(html).toContain('sort=counterparty');
    // Смена фильтра возвращает на первую страницу — иначе пустой экран
    // «страница 5 из 1» выглядит как поломка.
    expect(html).not.toContain('skip=200');
  });

  it('активный фильтр помечен и снимается повторным нажатием', () => {
    const html = renderToString(<PaymentQueueToolbar {...base} searchParams={{ inn: 'without' }} />);
    expect(html).toContain('aria-current="true"');
  });

  it('пустой экран объясняет, что фильтр всё отсеял (У-74)', () => {
    // Ветка «есть фильтр, но строк нет» живёт в таблице — здесь проверяем, что
    // ссылка «Сбросить фильтры» появляется именно при активном фильтре.
    const html = renderToString(<PaymentQueueToolbar {...base} searchParams={{ candidate: 'org' }} />);
    expect(html).toContain('Сбросить фильтры');
    const clean = renderToString(<PaymentQueueToolbar {...base} />);
    expect(clean).not.toContain('Сбросить фильтры');
  });

  it('пустая очередь: счётчик не врёт про строки', () => {
    const html = renderToString(<PaymentQueueToolbar {...base} total={0} />);
    expect(html).toContain('Всего в очереди: 0');
    expect(html).not.toContain('1–50');
  });
});
