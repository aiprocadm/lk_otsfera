import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { OneCPushStatusSelect } from '@/components/documents/one-c-push-status-select';

/** `У-169`: фильтр «Выгрузка в 1С» — общий для трёх кабинетов сотрудников. */
describe('OneCPushStatusSelect', () => {
  it('первый пункт — «все», дальше статусы по порядку словаря, начиная с ошибок', () => {
    const html = renderToString(<OneCPushStatusSelect value={undefined} />);
    expect(html).toContain('name="oneCPushStatus"');
    expect(html).toContain('aria-label="Выгрузка в 1С"');
    const all = html.indexOf('Выгрузка в 1С: все');
    const failed = html.indexOf('Ошибка выгрузки');
    const none = html.indexOf('Не выгружался');
    expect(all).toBeGreaterThan(-1);
    expect(failed).toBeGreaterThan(all);
    expect(none).toBeGreaterThan(failed);
  });

  it('текущее значение из адреса становится выбранным; чужое слово — «все»', () => {
    expect(renderToString(<OneCPushStatusSelect value="failed" />)).toContain(
      '<option value="failed" selected="">'
    );
    expect(renderToString(<OneCPushStatusSelect value="nope" />)).toContain(
      '<option value="" selected="">'
    );
  });
});
