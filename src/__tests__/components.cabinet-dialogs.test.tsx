import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CabinetDialogRow } from '@/lib/services/cabinetDialogs/list';
import type { CabinetDialogView } from '@/lib/services/cabinetDialogs/get';

vi.mock('@/components/cabinet-dialogs/cabinet-reply-form', () => ({
  CabinetReplyForm: ({ hint }: { hint?: string }) =>
    React.createElement('div', { 'data-testid': 'reply-form' }, hint ?? 'no-hint'),
}));

import { CabinetDialogsPanel } from '@/components/cabinet-dialogs/cabinet-dialogs-panel';
import { MessagesTabs } from '@/components/cabinet-dialogs/messages-tabs';

/** «Переписка с менеджером» (`У-234`): список, лента, вкладки. */

function row(over: Partial<CabinetDialogRow> = {}): CabinetDialogRow {
  return {
    id: 'd1',
    channel: 'cabinet',
    channelLabel: 'Кабинет',
    isCabinet: true,
    lastMessageAt: new Date('2026-09-17T10:00:00Z'),
    preview: 'Здравствуйте',
    lastDirection: 'out',
    ...over,
  };
}

function view(over: Partial<CabinetDialogView> = {}): CabinetDialogView {
  return {
    id: 'd1',
    channel: 'cabinet',
    channelLabel: 'Кабинет',
    isCabinet: true,
    hiddenCount: 0,
    messages: [
      {
        id: 'm1',
        direction: 'in',
        body: 'Вопрос про обучение',
        createdAt: new Date('2026-09-17T09:00:00Z'),
        attachmentName: null,
      },
      {
        id: 'm2',
        direction: 'out',
        body: 'Отвечаем: группа набрана',
        createdAt: new Date('2026-09-17T10:00:00Z'),
        attachmentName: 'plan.pdf',
      },
    ],
    ...over,
  };
}

function panel(dialogs: CabinetDialogRow[], selected: CabinetDialogView | null) {
  return renderToStaticMarkup(
    React.createElement(CabinetDialogsPanel, {
      basePath: '/organization/messages',
      dialogs,
      selected,
    })
  );
}

describe('CabinetDialogsPanel', () => {
  it('список: канал, время, автор последней реплики; ссылка открывает переписку', () => {
    const out = panel(
      [
        row(),
        row({
          id: 'd2',
          channelLabel: 'Telegram',
          isCabinet: false,
          lastDirection: 'in',
          preview: 'Вопрос',
        }),
      ],
      null
    );
    expect(out).toContain('data-testid="cabinet-dialog-d1"');
    expect(out).toContain('href="/organization/messages?tab=manager&amp;dialog=d1"');
    expect(out).toContain('Менеджер: Здравствуйте');
    expect(out).toContain('Вы: Вопрос');
    expect(out).toContain('Telegram');
    // Ничего не выбрано — подсказка, что делать дальше, и форма ответа на месте.
    expect(out).toContain('Выберите переписку слева');
    expect(out).toContain('data-testid="reply-form"');
  });

  it('пустой список объясняет себя и не прячет поле ответа (У-74)', () => {
    const out = panel([], null);
    expect(out).toContain('Переписки пока нет');
    expect(out).toContain('data-testid="reply-form"');
  });

  it('лента: входящие и исходящие подписаны, файл виден, скрытые посчитаны', () => {
    const out = panel([row()], view({ hiddenCount: 12 }));
    expect(out).toContain('data-testid="cabinet-message-m1"');
    expect(out).toContain('Вопрос про обучение');
    expect(out).toContain('Отвечаем: группа набрана');
    expect(out).toContain('📎 plan.pdf');
    expect(out).toContain('ещё 12 выше по переписке');
    expect(out).toContain('Менеджер');
    expect(out).toContain('Вы');
  });

  it('диалог мессенджера: подсказка, что ответ уйдёт в кабинет', () => {
    const out = panel([row()], view({ isCabinet: false, channelLabel: 'Telegram' }));
    expect(out).toContain('Ответ уйдёт в переписку кабинета');
    expect(out).toContain('«Telegram»');
  });

  it('переписка без сообщений: объяснение вместо пустоты', () => {
    const out = panel([row()], view({ messages: [] }));
    expect(out).toContain('Сообщений пока нет');
    expect(out).toContain('Напишите первым');
  });

  it('хвост адреса сохраняется в ссылках (не уводит в другую организацию)', () => {
    const out = renderToStaticMarkup(
      React.createElement(CabinetDialogsPanel, {
        basePath: '/organization/messages',
        query: { org: 'o1' },
        dialogs: [row()],
        selected: null,
      })
    );
    expect(out).toContain('org=o1');
  });
});

describe('MessagesTabs', () => {
  it('две вкладки: названия, активная помечена, адреса с `tab=`', () => {
    const out = renderToStaticMarkup(
      React.createElement(MessagesTabs, {
        basePath: '/partner/messages',
        active: 'manager',
        tabs: ['manager', 'orders'],
      })
    );
    expect(out).toContain('Переписка с менеджером');
    expect(out).toContain('По заказам');
    expect(out).toContain('aria-current="page"');
    expect(out).toContain('href="/partner/messages?tab=orders"');
  });

  it('одна доступная вкладка — панель вкладок не рисуется', () => {
    const out = renderToStaticMarkup(
      React.createElement(MessagesTabs, {
        basePath: '/partner/messages',
        active: 'manager',
        tabs: ['manager'],
      })
    );
    expect(out).toBe('');
  });
});
