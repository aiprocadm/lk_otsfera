import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ChannelHealthPanel } from '@/components/admin/channel-health-panel';
import type { ChannelHealthRow } from '@/lib/services/messengers/channelHealth';

/**
 * Светофор каналов на экране (`У-213`, этап 3 PR-7).
 *
 * Главное правило показа здесь — про ПУСТОТУ. «Ни одного входящего никогда» и
 * «входящих не было сегодня» — разные вещи, а прочерк на месте даты человек
 * читает как «сломалось». Поэтому пустое значение подписано словами.
 */
const row = (over: Partial<ChannelHealthRow> = {}): ChannelHealthRow => ({
  channel: 'telegram',
  lastInboundAt: null,
  lastErrorAt: null,
  lastError: null,
  ...over,
});

const html = (rows: ChannelHealthRow[], actionsFor?: (channel: string) => React.ReactNode) =>
  renderToString(<ChannelHealthPanel rows={rows} {...(actionsFor ? { actionsFor } : {})} />);

/** Кусок разметки одного канала: подзаголовок панели в проверки строки не лезет. */
function cardOf(out: string, channel = 'telegram'): string {
  const start = out.indexOf(`data-testid="channel-health-${channel}"`);
  expect(start, `карточки канала ${channel} нет в разметке`).toBeGreaterThan(-1);
  const end = out.indexOf('</li>', start);
  return out.slice(start, end);
}

describe('ChannelHealthPanel — пустые значения подписаны словами', () => {
  it('входящих не было ни разу — так и написано, без прочерка', () => {
    const card = cardOf(html([row()]));
    expect(card).toContain('ни одного сообщения ещё не приходило');
    // Прочерк на этом месте выглядел бы как поломка самой панели.
    expect(card).not.toContain('—');
  });

  it('ошибок не было — отдельная спокойная строка, а не пустое место', () => {
    expect(html([row()])).toContain('Ошибок отправки не было.');
  });

  it('когда ошибка есть, спокойной строки нет — иначе панель противоречит себе', () => {
    const out = html([
      row({ lastErrorAt: new Date('2026-09-15T09:30:00Z'), lastError: 'Бот заблокирован' }),
    ]);
    expect(out).not.toContain('Ошибок отправки не было.');
    expect(out).toContain('Бот заблокирован');
  });
});

describe('ChannelHealthPanel — что показано', () => {
  it('дата последнего входящего печатается человеческим форматом', () => {
    const out = html([row({ lastInboundAt: new Date('2026-09-14T08:00:00Z') })]);
    // Московское время: 08:00 UTC → 11:00.
    expect(out).toContain('14.09.2026');
    expect(out).toContain('11:00');
  });

  it('ошибка без сохранённой причины показывает время и не печатает «null»', () => {
    const out = html([row({ lastErrorAt: new Date('2026-09-15T09:30:00Z') })]);
    expect(out).toContain('Последняя ошибка отправки');
    expect(out).not.toContain('null');
  });

  it('каналы названы так же, как во всех кабинетах (§0.2 «правило зеркала»)', () => {
    const out = html([row(), row({ channel: 'max' }), row({ channel: 'whatsapp' })]);
    for (const label of ['Telegram', 'MAX', 'WhatsApp']) expect(out).toContain(label);
  });

  it('заголовок и подзаголовок отвечают «где я» и «что здесь» (§15)', () => {
    const out = html([row()]);
    expect(out).toContain('Как работают каналы');
    expect(out).toContain('Приходят ли сообщения от клиентов');
  });

  it('пустой список каналов не роняет панель', () => {
    expect(html([])).toContain('Как работают каналы');
  });
});

describe('ChannelHealthPanel — кнопки проверки', () => {
  it('кнопки страницы встают рядом со своим каналом', () => {
    const out = html([row(), row({ channel: 'max' })], (channel) => (
      <span>{`проверить ${channel}`}</span>
    ));
    expect(out).toContain('проверить telegram');
    expect(out).toContain('проверить max');
  });

  it('без кнопок панель работает — это необязательная часть', () => {
    expect(html([row()])).toContain('Telegram');
  });
});
