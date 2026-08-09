/**
 * Примитив карточек (`У-18`, этап 3): мобильный вид широких таблиц.
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { CardList, Card, CardRow } from '@/components/ui/card-list';

describe('CardList / Card / CardRow', () => {
  it('список скрыт на десктопе — там остаётся таблица', () => {
    const html = renderToString(
      <CardList>
        <Card title="Заголовок">
          <CardRow label="Поле">значение</CardRow>
        </Card>
      </CardList>
    );
    expect(html).toContain('md:hidden');
    expect(html).toContain('Заголовок');
    expect(html).toContain('Поле');
    expect(html).toContain('значение');
  });

  it('дополнительный класс списка применяется', () => {
    const html = renderToString(<CardList className="p-4">{null}</CardList>);
    expect(html).toContain('p-4');
  });

  it('карточка показывает действия справа от заголовка', () => {
    const html = renderToString(
      <CardList>
        <Card title="Т" actions={<button type="button">Откатить</button>}>
          <CardRow label="П">1</CardRow>
        </Card>
      </CardList>
    );
    expect(html).toContain('Откатить');
  });

  it('без действий блок действий не рисуется', () => {
    const html = renderToString(
      <CardList>
        <Card title="Т">
          <CardRow label="П">1</CardRow>
        </Card>
      </CardList>
    );
    expect(html).toContain('Т');
    expect(html).not.toContain('Откатить');
  });

  it('пустое значение показывается прочерком, а не пропадает', () => {
    const html = renderToString(
      <CardList>
        <Card title="Т">
          <CardRow label="Пусто" />
        </Card>
      </CardList>
    );
    expect(html).toContain('—');
  });

  it('пустая строка тоже показывается прочерком', () => {
    const html = renderToString(
      <CardList>
        <Card title="Т">
          <CardRow label="Пусто">{''}</CardRow>
        </Card>
      </CardList>
    );
    expect(html).toContain('—');
  });
});
