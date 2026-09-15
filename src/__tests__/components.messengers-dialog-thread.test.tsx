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
    // `У-215`: связь с письмом «Входящих» есть не у каждой реплики — у этой
    // нет, поэтому обратной ссылки в ленте быть не должно (проверяется ниже).
    inboundMessageId: null,
    attachment: null,
  },
  {
    id: 'm2',
    direction: 'out',
    body: 'добрый день',
    createdAt: at,
    deliveryStatus: 'sent',
    authorName: 'Мария',
    inboundMessageId: null,
    attachment: null,
  },
  {
    id: 'm3',
    direction: 'out',
    body: 'не дошло',
    createdAt: at,
    deliveryStatus: 'failed',
    authorName: null,
    inboundMessageId: null,
    attachment: null,
  },
];

describe('DialogThread', () => {
  it('пустая лента объясняет, что делать', () => {
    const html = renderToString(<DialogThread dialogId="d1" messages={[]} hiddenCount={0} />);
    expect(html).toContain('Напишите первым');
    expect(html).not.toContain('<ol');
  });

  it('входящие слева, исходящие справа с автором; неудачная отправка помечена', () => {
    const html = renderToString(<DialogThread dialogId="d1" messages={messages} hiddenCount={0} />);
    expect(html).toContain('justify-start');
    expect(html).toContain('justify-end');
    expect(html).toContain('здравствуйте');
    expect(html).toContain('Мария');
    expect(html).toContain('Сотрудник');
    expect(html).toContain('не доставлено');
    expect(html.match(/не доставлено/g)?.length).toBe(1);
    expect(html).not.toContain('старше');
  });

  it('`У-215`: реплика из письма ведёт обратно во «Входящие», остальные — никуда', () => {
    // Письмо лежит в очереди разбора со своей привязкой к организации,
    // вложением и историей разбора. Без обратной ссылки его искали руками по
    // имени отправителя; ссылка ставится в обе стороны (прямая — в списке
    // «Входящих»).
    const html = renderToString(
      <DialogThread
        dialogId="d1"
        messages={[{ ...messages[0]!, inboundMessageId: 'inb-42' }, messages[1]!]}
        hiddenCount={0}
      />
    );
    expect(html).toContain('href="/manager/inbox?message=inb-42"');
    // Ровно одна ссылка на две реплики: у исходящего письма-ответа источника
    // во «Входящих» нет, вести оттуда некуда.
    expect(html.match(/Открыть во «Входящих»/g)?.length).toBe(1);
  });

  it('лента без писем не показывает обратных ссылок', () => {
    const html = renderToString(<DialogThread dialogId="d1" messages={messages} hiddenCount={0} />);
    expect(html).not.toContain('Открыть во «Входящих»');
    expect(html).not.toContain('/manager/inbox?message=');
  });

  it('пометка о скрытых старых сообщениях', () => {
    // renderToString разделяет соседние текстовые узлы комментариями — снимаем их.
    const html = renderToString(
      <DialogThread dialogId="d1" messages={messages} hiddenCount={12} />
    ).replace(/<!-- -->/g, '');
    expect(html).toContain('Показаны последние 3 сообщений, ещё 12 старше.');
  });
});
