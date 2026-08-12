import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { AutoCreatedBadge } from '@/components/organization/auto-created-badge';

/**
 * `У-54`: человек, открывший карточку организации без договора и менеджера,
 * должен понимать, откуда она взялась, — а не выяснять это по журналу аудита.
 */
describe('AutoCreatedBadge (У-54)', () => {
  it('показывает дату выгрузки и имя файла', () => {
    const html = renderToString(
      <AutoCreatedBadge mark={{ at: '2026-08-12T09:00:00.000Z', fileName: 'Карточка 51.xls' }} />
    );
    expect(html).toContain('Создана автоматически из выгрузки 1С');
    expect(html).toContain('Карточка 51.xls');
    // §15 «что делать дальше»: плашка не только сообщает, но и подсказывает.
    expect(html).toContain('назначьте');
  });

  it('без имени файла остаётся читаемой', () => {
    const html = renderToString(
      <AutoCreatedBadge mark={{ at: '2026-08-12T09:00:00.000Z', fileName: null }} />
    );
    expect(html).toContain('Создана автоматически');
    expect(html).not.toContain('(файл');
  });

  it('обычная организация плашки не получает', () => {
    expect(renderToString(<AutoCreatedBadge mark={null} />)).toBe('');
  });
});
