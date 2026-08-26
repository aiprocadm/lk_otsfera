import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { CabinetHeaderTitle } from '@/components/shell/cabinet-header-title';

/**
 * `У-115`: подпись в шапке — один компонент на все кабинеты. Тест держит его
 * от возврата к «своей» шапке в каждом каркасе.
 */
describe('CabinetHeaderTitle (У-115)', () => {
  it('рисует «<Кабинет> · <кто>»', () => {
    const html = renderToString(
      React.createElement(CabinetHeaderTitle, { role: 'partner', subject: 'Иван' })
    );
    expect(html).toContain('Кабинет партнёра');
    // React разрезает текстовые узлы комментарием-разделителем, поэтому
    // сравниваем по видимому тексту, а не по сырой разметке.
    expect(html.replace(/<[^>]*>/g, '')).toContain('· Иван');
  });

  it('без имени рисует только кабинет, без точки', () => {
    const html = renderToString(
      React.createElement(CabinetHeaderTitle, { role: 'organization', subject: null })
    );
    expect(html).toContain('Кабинет заказчика');
    expect(html).not.toContain('·');
  });

  it('оба кабинета клиентов рисуются одной разметкой', () => {
    // Сравниваем «скелет» разметки: классы и вложенность, без самого текста.
    const strip = (s: string) => s.replace(/>[^<]*</g, '>T<');
    const org = renderToString(
      React.createElement(CabinetHeaderTitle, { role: 'organization', subject: 'ООО Ромашка' })
    );
    const partner = renderToString(
      React.createElement(CabinetHeaderTitle, { role: 'partner', subject: 'Иван' })
    );
    expect(strip(org)).toBe(strip(partner));
  });
});
