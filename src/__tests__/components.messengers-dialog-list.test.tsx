// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { DialogList } from '@/components/manager/messengers/dialog-list';
import { DialogFiltersBar } from '@/components/manager/messengers/dialog-filters';
import type { DialogListItem } from '@/lib/services/messengers/list';

/**
 * Список и фильтры диалогов (спека 2026-09-12 §5.1): подписи каналов из
 * реестра, «Не привязан» у общей очереди, «Вы:» у исходящих, счётчик
 * непрочитанных, карточки на телефоне, ссылки фильтров.
 */
const base: DialogListItem = {
  id: 'd1',
  channel: 'telegram',
  peerLabel: 'Иван Петров',
  organization: { id: 'o1', name: 'Ромашка' },
  status: 'open',
  assignee: null,
  overdue: 'none',
  unreadCount: 3,
  lastMessageAt: new Date('2026-09-10T10:00:00Z'),
  lastMessagePreview: 'нужен счёт',
  lastMessageDirection: 'in',
  bound: true,
};

describe('DialogList — ответственный и состояние (этап 3)', () => {
  it('без ответственного видно сразу, с ответственным — его имя', () => {
    const none = renderToString(<DialogList items={[base]} />);
    expect(none).toContain('Без ответственного');
    const mine = renderToString(
      <DialogList items={[{ ...base, assignee: { id: 'u1', name: 'Мария' } }]} />
    );
    expect(mine).toContain('Мария');
    expect(mine).not.toContain('Без ответственного');
  });

  it('просроченный диалог помечен словом «просрочен», ждущий клиента — нет', () => {
    const overdue = renderToString(
      <DialogList items={[{ ...base, status: 'waiting_staff', overdue: 'overdue' }]} />
    );
    expect(overdue).toContain('просрочен');
    const waitingClient = renderToString(
      <DialogList items={[{ ...base, status: 'waiting_client', overdue: 'none' }]} />
    );
    expect(waitingClient).toContain('Ждём клиента');
    expect(waitingClient).not.toContain('просрочен');
  });
});

describe('DialogList', () => {
  it('строка: канал, собеседник со ссылкой, организация, превью, непрочитанные', () => {
    const html = renderToString(<DialogList items={[base]} />);
    expect(html).toContain('Telegram');
    expect(html).toContain('href="/manager/messengers/d1"');
    expect(html).toContain('Иван Петров');
    expect(html).toContain('href="/manager/organizations/o1"');
    expect(html).toContain('Ромашка');
    expect(html).toContain('нужен счёт');
    expect(html).not.toContain('Вы: нужен счёт');
    expect(html).toContain('Непрочитанных: 3');
    expect(html).not.toContain('Закрыт');
    // Таблица и карточки — обе раскладки в разметке (переключает CSS).
    expect(html).toContain('hidden md:block');
    expect(html).toContain('md:hidden');
  });

  it('исходящее помечено «Вы:», без превью — прочерк, закрытый — бейдж, без непрочитанных — без пилла', () => {
    const html = renderToString(
      <DialogList
        items={[
          {
            ...base,
            id: 'd2',
            channel: 'max',
            lastMessageDirection: 'out',
            lastMessagePreview: 'ответил',
            status: 'closed',
            unreadCount: 0,
          },
          { ...base, id: 'd3', channel: 'whatsapp', lastMessagePreview: null },
        ]}
      />
    );
    expect(html).toContain('MAX');
    expect(html).toContain('WhatsApp');
    expect(html).toContain('Вы: ответил');
    expect(html).toContain('Закрыт');
    expect(html).not.toContain('Непрочитанных: 0');
    expect(html).toContain('—');
  });

  it('ничей диалог — «Не привязан»; привязанный без организации — «Без организации»', () => {
    const html = renderToString(
      <DialogList
        items={[
          { ...base, id: 'd4', bound: false, organization: null },
          { ...base, id: 'd5', bound: true, organization: null },
        ]}
      />
    );
    expect(html).toContain('Не привязан');
    expect(html).toContain('Без организации');
  });
});

describe('DialogFiltersBar', () => {
  it('строит ссылки с параметрами и подсвечивает активные', () => {
    const html = renderToString(<DialogFiltersBar channel="max" status="closed" />);
    expect(html).toContain('href="/manager/messengers?status=closed"');
    expect(html).toContain('href="/manager/messengers?channel=telegram&amp;status=closed"');
    expect(html).toContain('href="/manager/messengers?channel=max"');
    expect(html).toContain('href="/manager/messengers?channel=max&amp;status=open"');
    // Состояния этапа 3: четыре, с человеческими подписями из автомата.
    expect(html).toContain('Ждёт ответа');
    expect(html).toContain('Ждём клиента');
    expect(html).toContain('Закрыт');
    // Третья группа фильтров — ответственный (У-206).
    expect(html).toContain('Ответственный');
    expect(html).toContain(
      'href="/manager/messengers?channel=max&amp;status=closed&amp;assignee=mine"'
    );
    // Активные пиллы — оранжевые (MAX и «Закрытые»), остальные — с рамкой.
    // Активных «Все» теперь три: мессенджер, состояние, ответственный.
    expect(html.match(/bg-orange-500/g)?.length).toBe(3);
  });

  it('без фильтров активны оба «Все» и ссылки ведут на корень', () => {
    const html = renderToString(<DialogFiltersBar />);
    expect(html).toContain('href="/manager/messengers"');
    // Активных «Все» теперь три: мессенджер, состояние, ответственный.
    expect(html.match(/bg-orange-500/g)?.length).toBe(3);
  });
});
