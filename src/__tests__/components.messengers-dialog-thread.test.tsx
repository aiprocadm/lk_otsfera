// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { DialogThread } from '@/components/manager/messengers/dialog-thread';
import type { DialogMessageView } from '@/lib/services/messengers/get';

/** Лента диалога (спека 2026-09-12 §5.2). */
const at = new Date('2026-09-10T10:00:00Z');

const messages: DialogMessageView[] = [
  {
    id: 'm1',
    direction: 'in',
    body: 'здравствуйте',
    createdAt: at,
    deliveryStatus: 'sent',
    authorName: null,
  },
  {
    id: 'm2',
    direction: 'out',
    body: 'добрый день',
    createdAt: at,
    deliveryStatus: 'sent',
    authorName: 'Мария',
  },
  {
    id: 'm3',
    direction: 'out',
    body: 'не дошло',
    createdAt: at,
    deliveryStatus: 'failed',
    authorName: null,
  },
];

describe('DialogThread', () => {
  it('пустая лента объясняет, что делать', () => {
    const html = renderToString(<DialogThread messages={[]} hiddenCount={0} />);
    expect(html).toContain('Напишите первым');
    expect(html).not.toContain('<ol');
  });

  it('входящие слева, исходящие справа с автором; неудачная отправка помечена', () => {
    const html = renderToString(<DialogThread messages={messages} hiddenCount={0} />);
    expect(html).toContain('justify-start');
    expect(html).toContain('justify-end');
    expect(html).toContain('здравствуйте');
    expect(html).toContain('Мария');
    expect(html).toContain('Сотрудник');
    expect(html).toContain('не доставлено');
    expect(html.match(/не доставлено/g)?.length).toBe(1);
    expect(html).not.toContain('старше');
  });

  it('пометка о скрытых старых сообщениях', () => {
    // renderToString разделяет соседние текстовые узлы комментариями — снимаем их.
    const html = renderToString(<DialogThread messages={messages} hiddenCount={12} />).replace(
      /<!-- -->/g,
      ''
    );
    expect(html).toContain('Показаны последние 3 сообщений, ещё 12 старше.');
  });
});
