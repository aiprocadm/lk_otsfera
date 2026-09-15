// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

// `У-213`: у недоставленной реплики в ленте появилась клиентская кнопка
// «Повторить», а она зовёт `useRouter()`. Вне приложения роутера нет, и без
// подмены падал бы сам рендер — то есть тест ругался бы не на то, что проверяет.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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
    // `У-213`: у доставленных причины нет — поле есть всегда, значение пустое.
    deliveryError: null,
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
    deliveryError: null,
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
    // `У-213`: у неудачной отправки причина ЕСТЬ и обязана доехать до экрана —
    // «не доставлено» без объяснения не говорит человеку, что делать дальше.
    deliveryError: 'Клиент заблокировал бота',
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
    // `У-213`: рядом с пометкой — ПРИЧИНА и кнопка повтора. «Не доставлено» в
    // одиночку не говорит, что делать: клиент заблокировал бота — это одно,
    // канал не настроен — совсем другое, и лечатся они по-разному.
    expect(html).toContain('Клиент заблокировал бота');
    expect(html).toContain('Повторить');
    // Причина и кнопка — только у неудачной реплики, а не у каждой.
    expect(html.match(/Повторить/g)?.length).toBe(1);
    expect(html).not.toContain('старше');
  });

  it('`У-213`: у доставленных реплик нет ни причины, ни кнопки повтора', () => {
    // Иначе лента предлагала бы «переотправить» то, что уже дошло.
    const html = renderToString(
      <DialogThread dialogId="d1" messages={[messages[0]!, messages[1]!]} hiddenCount={0} />
    );
    expect(html).not.toContain('Повторить');
    expect(html).not.toContain('не доставлено');
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
