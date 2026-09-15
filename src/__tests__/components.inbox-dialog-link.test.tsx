// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

// Формы разбора — клиентские; здесь важны только ссылки, поэтому формы
// подменены заглушками (как в соседнем тесте списка «Входящих»).
vi.mock('@/components/manager/inbox-bind-form', () => ({
  InboxBindForm: () => React.createElement('div'),
}));
vi.mock('@/components/manager/inbox-reply-form', () => ({
  InboxReplyForm: () => React.createElement('div'),
}));
vi.mock('@/components/intake/source-intake-actions', () => ({
  SourceIntakeActions: () => React.createElement('div'),
}));
vi.mock('@/components/manager/inbox-archive-button', () => ({
  InboxArchiveButton: () => React.createElement('div'),
}));

import { InboxList } from '@/components/manager/inbox-list';
import { DialogThread } from '@/components/manager/messengers/dialog-thread';
import type { InboxItem } from '@/lib/services/inbound/listInbox';
import type { DialogMessageView } from '@/lib/services/messengers/get';

/**
 * Ссылки между очередью разбора и перепиской (`У-215`, этап 3 PR-6).
 *
 * Одно и то же сообщение живёт в двух местах: строкой во «Входящих в работу» и
 * репликой в диалоге. До этого перейти между ними было нельзя — диалог искали
 * руками по имени отправителя. Ссылки обязаны стоять В ОБЕ стороны, и на
 * телефоне тоже: у списка «Входящих» две раскладки (таблица и карточки), и
 * половина правок легко попадает только в одну из них.
 */

const base: InboxItem = {
  id: 'msg-1',
  channel: 'telegram',
  senderRef: '@vasya',
  senderDisplay: 'Вася',
  subject: null,
  body: 'Добрый день, нужна консультация',
  createdAt: new Date('2026-09-10T09:00:00Z'),
  status: 'bound',
  resolvedOrgId: 'org-1',
  scanStatus: 'none',
  attachmentName: null,
  dialogId: 'd-42',
};

const ORGS = [{ id: 'org-1', name: 'Орг' }] as never;

/** Кол-во вхождений — «обе раскладки» = 2 (таблица + карточки на телефоне). */
function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('InboxList — «Открыть диалог» (У-215)', () => {
  it('ссылка стоит и в таблице, и в карточках', () => {
    const html = renderToString(<InboxList items={[base]} organizations={ORGS} />);
    expect(count(html, 'href="/manager/messengers/d-42"')).toBe(2);
    expect(count(html, 'Открыть диалог')).toBe(2);
  });

  it('у письма без диалога ссылки нет — вести некуда', () => {
    // Так выглядят старые письма (до сворачивания в диалоги) и каналы, которых
    // в переписке нет: ссылка вела бы в «не найдено».
    const html = renderToString(
      <InboxList items={[{ ...base, dialogId: null }]} organizations={ORGS} />
    );
    expect(html).not.toContain('Открыть диалог');
    expect(html).not.toContain('/manager/messengers/');
  });

  it('в смешанном списке ссылку получает только та строка, у которой есть диалог', () => {
    const html = renderToString(
      <InboxList
        items={[base, { ...base, id: 'msg-2', dialogId: null, senderDisplay: 'Пётр' }]}
        organizations={ORGS}
      />
    );
    expect(count(html, 'href="/manager/messengers/d-42"')).toBe(2);
    expect(count(html, 'Открыть диалог')).toBe(2);
  });
});

describe('DialogThread — «Открыть во «Входящих»» (У-215)', () => {
  const at = new Date('2026-09-10T10:00:00Z');

  function message(over: Partial<DialogMessageView> = {}): DialogMessageView {
    return {
      id: 'm1',
      direction: 'in',
      body: 'здравствуйте',
      createdAt: at,
      deliveryStatus: 'sent',
      deliveryError: null,
      authorName: null,
      inboundMessageId: 'msg-1',
      attachment: null,
      ...over,
    };
  }

  it('у реплики, выросшей из письма, есть обратная ссылка в очередь разбора', () => {
    const html = renderToString(
      <DialogThread dialogId="d-42" messages={[message()]} hiddenCount={0} />
    );
    expect(html).toContain('href="/manager/inbox?message=msg-1"');
    expect(html).toContain('Открыть во «Входящих»');
  });

  it('идентификатор письма попадает в адрес экранированным', () => {
    // Идентификатор письма приходит из внешнего канала — в нём может быть что
    // угодно; без экранирования «+» и «&» разрезали бы адрес.
    const html = renderToString(
      <DialogThread
        dialogId="d-42"
        messages={[message({ inboundMessageId: 'a+b&c=1' })]}
        hiddenCount={0}
      />
    );
    expect(html).toContain('href="/manager/inbox?message=a%2Bb%26c%3D1"');
  });

  it('у исходящего ответа и у внутренней заметки обратной ссылки нет', () => {
    const html = renderToString(
      <DialogThread
        dialogId="d-42"
        messages={[
          message({ id: 'm2', direction: 'out', authorName: 'Мария', inboundMessageId: null }),
          message({ id: 'm3', direction: 'note', authorName: 'Мария', inboundMessageId: null }),
        ]}
        hiddenCount={0}
      />
    );
    expect(html).not.toContain('Открыть во «Входящих»');
  });
});
