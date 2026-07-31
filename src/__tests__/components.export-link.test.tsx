// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { exportHref } from '@/lib/ui/exportHref';
import { ExportLink } from '@/components/ui';

/**
 * Этап 9 PR-3 (ФТ-12.1): общий хелпер ссылки выгрузки (жил двумя копиями в
 * реестрах удостоверений) и презентационный примитив кнопки над ним.
 */

describe('exportHref', () => {
  it('без параметров — голый base', () => {
    expect(exportHref('/api/x/export', {})).toBe('/api/x/export');
  });

  it('пустые и undefined-параметры отбрасываются', () => {
    expect(exportHref('/api/x/export', { a: '1', b: undefined, c: '' })).toBe('/api/x/export?a=1');
  });

  it('значения экранируются', () => {
    expect(exportHref('/api/x/export', { search: 'Иван Пётр' })).toBe(
      '/api/x/export?search=%D0%98%D0%B2%D0%B0%D0%BD+%D0%9F%D1%91%D1%82%D1%80'
    );
  });
});

describe('ExportLink', () => {
  it('ссылка с фильтрами и подписью по умолчанию', () => {
    render(
      React.createElement(ExportLink, {
        base: '/api/manager/orders/export',
        params: { search: 'abc', empty: undefined },
      })
    );
    const link = screen.getByText('Выгрузить в Excel') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/api/manager/orders/export?search=abc');
  });

  it('работает без параметров и принимает свою подпись и класс', () => {
    render(
      React.createElement(ExportLink, {
        base: '/api/x/export',
        label: 'Скачать',
        className: 'mt-2',
      })
    );
    const link = screen.getByText('Скачать') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/api/x/export');
    expect(link.className).toContain('mt-2');
  });
});
