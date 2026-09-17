import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PartnerMaterialRow } from '@/lib/services/partnerMaterials/partner';

vi.mock('@/components/partner/partner-material-download-button', () => ({
  PartnerMaterialDownloadButton: ({ materialId }: { materialId: string }) =>
    React.createElement('button', { 'data-testid': `dl-${materialId}` }, 'Скачать'),
}));

import { PartnerMaterialsList } from '@/components/partner/partner-materials-list';

/** Раздел «Материалы» партнёра (`У-237`): карточки по категориям, поиск, «Новое», издатель. */

function row(over: Partial<PartnerMaterialRow> = {}): PartnerMaterialRow {
  return {
    id: 'm1',
    title: 'Прайс осень',
    description: 'Цены на обучение',
    category: 'price_list',
    companyId: 'c1',
    companyName: 'УЦ Промтехносфера',
    externalUrl: null,
    file: { fileName: 'price.pdf', mimeType: 'application/pdf', size: 2 * 1024 * 1024 },
    publishedAt: new Date('2026-09-16T00:00:00Z'),
    updatedAt: new Date('2026-09-16T00:00:00Z'),
    isNew: true,
    ...over,
  };
}

function html(rows: PartnerMaterialRow[], q = '') {
  return renderToStaticMarkup(React.createElement(PartnerMaterialsList, { rows, q }));
}

describe('PartnerMaterialsList', () => {
  it('группы по категориям в порядке справочника, «Новое», издатель, размер файла, кнопка «Скачать»', () => {
    const out = html([
      row({
        id: 'b',
        category: 'instruction',
        title: 'Инструкция',
        isNew: false,
        file: { fileName: 'i.pdf', mimeType: 'application/pdf', size: 900 },
      }),
      row({ id: 'a' }),
    ]);
    expect(out.indexOf('data-testid="materials-price_list"')).toBeLessThan(
      out.indexOf('data-testid="materials-instruction"')
    );
    expect(out).toContain('Прайс-листы');
    expect(out).toContain('Инструкции');
    expect(out).toContain('Новое');
    expect(out).toContain('УЦ Промтехносфера');
    expect(out).toContain('price.pdf · 2.0 МБ');
    expect(out).toContain('i.pdf · 900 Б');
    expect(out).toContain('data-testid="dl-a"');
    expect(out).toContain('name="q"');
  });

  it('материал-ссылка — «Открыть» в новой вкладке, без кнопки скачивания; килобайты', () => {
    const out = html([
      row({ id: 'l', externalUrl: 'https://x.ru/p', file: null }),
      row({ id: 'k', file: { fileName: 'k.pdf', mimeType: 'application/pdf', size: 150 * 1024 } }),
    ]);
    expect(out).toContain('href="https://x.ru/p"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('Открыть ↗');
    expect(out).not.toContain('data-testid="dl-l"');
    expect(out).toContain('k.pdf · 150 КБ');
  });

  it('пусто: объяснение без поиска и «ничего не найдено» с поиском (значение поиска остаётся)', () => {
    expect(html([])).toContain('их публикует учебный центр');
    const searched = html([], 'прайс');
    expect(searched).toContain('ничего не найдено');
    expect(searched).toContain('value="прайс"');
  });
});
