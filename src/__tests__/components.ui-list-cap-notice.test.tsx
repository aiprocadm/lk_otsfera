import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { ListCapNotice } from '@/components/ui/list-cap-notice';

/**
 * `С-6` (сопровождение): список обрезан по `take`, а человек этого не видит —
 * думает, что документов/записей ровно столько, сколько на экране.
 * Примитив показывает «Показаны первые N из M» только когда есть что скрывать.
 */
describe('ListCapNotice', () => {
  it('ничего не рисует, когда показано всё (total ≤ shown)', () => {
    expect(renderToString(React.createElement(ListCapNotice, { shown: 3, total: 3 }))).toBe('');
    expect(renderToString(React.createElement(ListCapNotice, { shown: 200, total: 0 }))).toBe('');
  });

  it('пишет «N из M» и подсказку про фильтр, когда строк больше, чем показано', () => {
    const html = renderToString(React.createElement(ListCapNotice, { shown: 200, total: 731 }));
    expect(html).toContain('Показаны первые 200 из 731');
    expect(html).toContain('уточните фильтр');
    expect(html).toContain('role="status"');
  });

  it('подсказку можно заменить своей — у очереди нет фильтра, там «разберите эти»', () => {
    const html = renderToString(
      React.createElement(ListCapNotice, {
        shown: 200,
        total: 350,
        hint: 'Разберите эти — появятся следующие.',
      })
    );
    expect(html).toContain('Показаны первые 200 из 350');
    expect(html).toContain('Разберите эти — появятся следующие.');
    expect(html).not.toContain('уточните фильтр');
  });
});
