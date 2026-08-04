import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { PiiAccessFilters } from '@/components/admin/pii-access-filters';

const PROPS = {
  contexts: [{ key: 'calls_list', labelRu: 'Журнал звонков' }],
  basePath: '/admin/settings/security/personal-data',
  subjectTypes: ['caller'],
  actors: [{ id: 'u1', name: 'Емп', email: 'e@x.ru' }],
};

describe('PiiAccessFilters', () => {
  it('рендерит фильтры без кнопки сброса при пустом current', () => {
    const html = renderToString(<PiiAccessFilters {...PROPS} current={{}} />);
    expect(html).toContain('Журнал звонков');
    expect(html).toContain('Емп (e@x.ru)');
    expect(html).not.toContain('Сбросить');
  });

  it('активный фильтр → есть «Сбросить» и defaultValue', () => {
    const html = renderToString(<PiiAccessFilters {...PROPS} current={{ subjectId: 'c42' }} />);
    expect(html).toContain('Сбросить');
    expect(html).toContain('c42');
  });
});
