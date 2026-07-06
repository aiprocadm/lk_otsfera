import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { ChatThreadView, type ChatMessageVM } from '@/components/chat/chat-thread-view';
import { ChatComposer } from '@/components/chat/chat-composer';

const noop = () => {};

describe('ChatThreadView', () => {
  it('renders empty state when no messages', () => {
    const html = renderToString(
      React.createElement(ChatThreadView, { messages: [], currentUserId: 'u1' })
    );
    expect(html).toContain('Пока нет сообщений');
  });

  it('renders mine and theirs messages with correct markers', () => {
    const messages: ChatMessageVM[] = [
      {
        id: 'm1',
        authorId: 'u1',
        authorName: 'Я',
        body: 'Привет от меня',
        createdAt: new Date('2024-01-15T10:00:00Z')
      },
      {
        id: 'm2',
        authorId: 'u2',
        authorName: 'Иван Иванов',
        body: 'Привет от другого',
        createdAt: new Date('2024-01-15T10:01:00Z')
      }
    ];

    const html = renderToString(
      React.createElement(ChatThreadView, { messages, currentUserId: 'u1' })
    );

    // Both bodies must appear
    expect(html).toContain('Привет от меня');
    expect(html).toContain('Привет от другого');

    // The other author's name must appear
    expect(html).toContain('Иван Иванов');

    // The "mine" message must be distinguishable
    expect(html).toContain('data-mine="true"');

    // The "theirs" message must not have data-mine="true" — it should have data-mine="false"
    expect(html).toContain('data-mine="false"');
  });

  it('renders attachment affordance when attachmentUrl is set', () => {
    const messages: ChatMessageVM[] = [
      {
        id: 'm3',
        authorId: 'u2',
        authorName: 'Коллега',
        body: 'Смотри вложение',
        attachmentUrl: '/files/doc.pdf',
        createdAt: new Date('2024-01-15T10:02:00Z')
      }
    ];

    const html = renderToString(
      React.createElement(ChatThreadView, { messages, currentUserId: 'u1' })
    );

    // Assert the actual link href, not just body text (which also contains "вложение")
    expect(html).toContain('href="/files/doc.pdf"');
  });

  it('renders attachment affordance with the "mine" color branch when the message is my own', () => {
    const messages: ChatMessageVM[] = [
      {
        id: 'm3b',
        authorId: 'u1',
        authorName: 'Я',
        body: 'моё вложение',
        attachmentUrl: '/files/mine.pdf',
        createdAt: new Date('2024-01-15T10:02:00Z')
      }
    ];

    const html = renderToString(
      React.createElement(ChatThreadView, { messages, currentUserId: 'u1' })
    );

    expect(html).toContain('href="/files/mine.pdf"');
    expect(html).toContain('rgba(255,255,255,0.85)');
  });

  it('accepts a string createdAt and formats it (Date-branch not taken)', () => {
    const messages: ChatMessageVM[] = [
      {
        id: 'm4',
        authorId: 'u1',
        authorName: 'Я',
        body: 'строка даты',
        createdAt: '2024-01-15T10:00:00Z'
      }
    ];
    const html = renderToString(
      React.createElement(ChatThreadView, { messages, currentUserId: 'u1' })
    );
    expect(html).toContain('строка даты');
  });

  it('renders empty time text when createdAt is an invalid date string', () => {
    const messages: ChatMessageVM[] = [
      {
        id: 'm5',
        authorId: 'u1',
        authorName: 'Я',
        body: 'битая дата',
        createdAt: 'not-a-date'
      }
    ];
    const html = renderToString(
      React.createElement(ChatThreadView, { messages, currentUserId: 'u1' })
    );
    expect(html).toContain('битая дата');
  });

  it('renders empty time text when fmtDateTime throws (catch branch)', async () => {
    // Force the catch branch: pass a value whose `instanceof Date` check passes
    // but whose getTime() throws, since fmtDateTime itself never throws for
    // valid Date instances. A Date subclass with a poisoned getTime achieves this.
    class ThrowingDate extends Date {
      getTime(): number {
        throw new Error('boom');
      }
    }
    const messages: ChatMessageVM[] = [
      {
        id: 'm6',
        authorId: 'u1',
        authorName: 'Я',
        body: 'исключение форматирования',
        createdAt: new ThrowingDate('2024-01-15T10:00:00Z')
      }
    ];
    const html = renderToString(
      React.createElement(ChatThreadView, { messages, currentUserId: 'u1' })
    );
    expect(html).toContain('исключение форматирования');
  });
});

describe('ChatComposer', () => {
  it('renders textarea with correct placeholder and submit button', () => {
    const html = renderToString(
      React.createElement(ChatComposer, { onSend: noop })
    );
    expect(html).toContain('Напишите сообщение');
    expect(html).toContain('Отправить');
  });

  it('renders file input when onAttachFile is provided', () => {
    const html = renderToString(
      React.createElement(ChatComposer, { onSend: noop, onAttachFile: noop })
    );
    expect(html).toContain('type="file"');
  });

  it('does NOT render file input when onAttachFile is not provided', () => {
    const html = renderToString(
      React.createElement(ChatComposer, { onSend: noop })
    );
    expect(html).not.toContain('type="file"');
  });
});
