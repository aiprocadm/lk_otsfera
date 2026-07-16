// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('@/components/manager/inbox-bind-form', () => ({
  InboxBindForm: (props: { inboundMessageId: string; organizations: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'bind-form' }, `bind:${props.inboundMessageId}:orgs=${props.organizations.length}`)
}));
vi.mock('@/components/manager/inbox-reply-form', () => ({
  InboxReplyForm: (props: { inboundMessageId: string }) =>
    React.createElement('div', { 'data-testid': 'reply-form' }, `reply:${props.inboundMessageId}`)
}));
vi.mock('@/components/manager/inbox-archive-button', () => ({
  InboxArchiveButton: (props: { inboundMessageId: string; mode: string }) =>
    React.createElement('div', { 'data-testid': 'archive-button' }, `${props.mode}:${props.inboundMessageId}`)
}));

import { InboxList } from '@/components/manager/inbox-list';
import { InboxFiltersBar } from '@/components/manager/inbox-filters';
import type { InboxItem } from '@/lib/services/inbound/listInbox';

const base: InboxItem = {
  id: 'msg-1',
  channel: 'telegram',
  senderRef: '@vasya',
  senderDisplay: 'Вася',
  subject: null,
  body: 'Добрый день, нужна консультация',
  createdAt: new Date('2026-07-01T09:00:00Z'),
  status: 'unresolved',
  resolvedOrgId: null,
  scanStatus: 'none',
  attachmentName: null
};

const ORGS = [{ id: 'org-1', name: 'Орг' }] as never;

/** Кол-во вхождений маркера мока — «обе раскладки» = 2 (таблица + карточки). */
function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('InboxList', () => {
  it('пустой список → EmptyState', () => {
    const html = renderToString(<InboxList items={[]} organizations={ORGS} />);
    expect(html).toContain('Обращений нет');
  });

  it('unresolved → форма привязки с организациями + «В архив» в обеих раскладках', () => {
    const html = renderToString(<InboxList items={[base]} organizations={ORGS} />);
    expect(html).toContain('bind:msg-1:orgs=1');
    expect(html).toContain('Не распознано');
    expect(html).toContain('Вася');
    expect(count(html, 'archive:msg-1')).toBe(2);
    expect(html).not.toContain('restore:msg-1');
  });

  it('bound → форма ответа + «В архив»; archived → «Вернуть» без форм', () => {
    const bound = renderToString(
      <InboxList items={[{ ...base, status: 'bound' }]} organizations={ORGS} />
    );
    expect(bound).toContain('reply:msg-1');
    expect(count(bound, 'archive:msg-1')).toBe(2);
    expect(bound).not.toContain('restore:msg-1');

    const archived = renderToString(
      <InboxList items={[{ ...base, status: 'archived' }]} organizations={ORGS} />
    );
    expect(archived).not.toContain('reply:');
    expect(archived).not.toContain('bind:');
    expect(archived).toContain('В архиве');
    expect(count(archived, 'restore:msg-1')).toBe(2);
    expect(archived).not.toContain('archive:msg-1');
  });

  it('senderDisplay=null → показывается senderRef; неизвестные channel/status — как есть, без архив-кнопок', () => {
    const html = renderToString(
      <InboxList
        items={[{ ...base, senderDisplay: null, channel: 'carrier-pigeon', status: 'odd' }]}
        organizations={ORGS}
      />
    );
    expect(html).toContain('@vasya');
    expect(html).toContain('carrier-pigeon');
    expect(html).toContain('odd');
    expect(html).not.toContain('archive:msg-1');
    expect(html).not.toContain('restore:msg-1');
  });

  it('subject рендерится, длинный body обрезается с многоточием', () => {
    const html = renderToString(
      <InboxList
        items={[{ ...base, subject: 'Срочно', body: 'а'.repeat(200) }]}
        organizations={ORGS}
      />
    );
    expect(html).toContain('Срочно');
    expect(html).toContain('…');
    expect(html).not.toContain('а'.repeat(200));
  });

  it.each([
    ['infected', 'Вложение: заражено'],
    ['pending', 'Вложение: проверяется'],
    ['clean', 'Вложение: чисто']
  ])('вложение со scanStatus=%s → бейдж «%s»', (scanStatus, label) => {
    const html = renderToString(
      <InboxList
        items={[{ ...base, attachmentName: 'a.pdf', scanStatus }]}
        organizations={ORGS}
      />
    );
    expect(html).toContain('a.pdf');
    expect(html).toContain(label);
  });

  it('scanStatus=none при вложении → без бейджа скана', () => {
    const html = renderToString(
      <InboxList
        items={[{ ...base, attachmentName: 'b.pdf', scanStatus: 'none' }]}
        organizations={ORGS}
      />
    );
    expect(html).toContain('b.pdf');
    expect(html).not.toContain('Вложение:');
  });

  it('clean вложение → имя становится ссылкой на download-роут', () => {
    const html = renderToString(
      <InboxList
        items={[{ ...base, attachmentName: 'a.pdf', scanStatus: 'clean' }]}
        organizations={ORGS}
      />
    );
    expect(html).toContain('href="/api/manager/inbox/msg-1/attachment"');
    expect(html).toContain('a.pdf');
  });

  it.each(['pending', 'infected', 'none'])(
    'scanStatus=%s → имя вложения без ссылки',
    (scanStatus) => {
      const html = renderToString(
        <InboxList
          items={[{ ...base, attachmentName: 'a.pdf', scanStatus }]}
          organizations={ORGS}
        />
      );
      expect(html).toContain('a.pdf');
      expect(html).not.toContain('/api/manager/inbox/msg-1/attachment');
    }
  );
});

describe('InboxFiltersBar', () => {
  it('без фильтров: обе группы, «Все» без query, ссылки на каналы и статусы', () => {
    const html = renderToString(<InboxFiltersBar />);
    expect(html).toContain('Канал');
    expect(html).toContain('Статус');
    expect(html).toContain('href="/manager/inbox"');
    expect(html).toContain('/manager/inbox?channel=telegram');
    expect(html).toContain('/manager/inbox?status=unresolved');
  });

  it('активные channel+status комбинируются в href обеих групп', () => {
    const html = renderToString(<InboxFiltersBar channel='email' status='bound' />);
    // группа каналов сохраняет status, группа статусов сохраняет channel
    expect(html).toContain('channel=telegram&amp;status=bound');
    expect(html).toContain('channel=email&amp;status=unresolved');
    // сброс канала («Все») оставляет только status
    expect(html).toContain('href="/manager/inbox?status=bound"');
  });
});
