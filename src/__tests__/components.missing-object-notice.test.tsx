import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MissingObjectNotice } from '@/components/ui/missing-object-notice';

/**
 * Плашка «объект недоступен» над списком раздела (`У-232`, спека §3.7).
 * Презентационный примитив без данных — проверяем текст и разметку, по
 * которой её находят страницы-тесты и скринридер.
 */
describe('MissingObjectNotice (У-232)', () => {
  it('называет объект по подписи и объясняет, что случилось и что делать', () => {
    const html = renderToStaticMarkup(<MissingObjectNotice what="Заказ" />);
    expect(html).toContain('data-testid="missing-object-notice"');
    // Плашка объявляется скринридеру как статус, а не как ошибка.
    expect(html).toContain('role="status"');
    expect(html).toContain('Заказ недоступен.');
    expect(html).toContain('Его удалили или у вас больше нет к нему доступа.');
    expect(html).toContain('Ниже — весь список раздела.');
  });

  it('без подписи говорит об «Объекте» — плашка не молчит и не печатает undefined', () => {
    const html = renderToStaticMarkup(<MissingObjectNotice />);
    expect(html).toContain('Объект недоступен.');
    expect(html).not.toContain('undefined');
  });
});

describe('MissingObjectNotice — род существительного', () => {
  it('женский род: «Задача недоступна», «Её удалили», «к ней»', () => {
    const html = renderToStaticMarkup(<MissingObjectNotice what="Задача" feminine />);
    expect(html).toContain('Задача недоступна.');
    expect(html).toContain('Её удалили');
    expect(html).toContain('к ней доступа');
    expect(html).not.toContain('недоступен');
  });

  it('мужской род по умолчанию: «Заказ недоступен», «Его удалили», «к нему»', () => {
    const html = renderToStaticMarkup(<MissingObjectNotice what="Заказ" />);
    expect(html).toContain('Заказ недоступен.');
    expect(html).toContain('Его удалили');
    expect(html).toContain('к нему доступа');
  });
});
