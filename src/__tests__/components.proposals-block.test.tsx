import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProposalsBlock } from '@/components/documents/proposals-block';
import type { ProposalBlockRow } from '@/lib/services/documents/proposalBlocks';

/**
 * `У-166` (этап 7) — общий блок «Коммерческие предложения».
 *
 * Компонент один на карточку сделки и карточку организации, поэтому здесь
 * проверяются его собственные обещания: строка читается целиком, ссылка ведёт
 * в раздел документов ТОГО кабинета, который его смонтировал, а пустой список
 * не оставляет на экране заголовок без содержимого.
 */
const ROW: ProposalBlockRow = {
  id: 'kp-1',
  number: 'КП-2026-12',
  status: 'sent',
  amountGross: '120000.00',
  sentAt: new Date('2026-08-21T09:00:00Z'),
  validUntil: new Date('2026-09-04T00:00:00Z'),
  createdAt: new Date('2026-08-21T08:00:00Z'),
};

const html = (rows: ProposalBlockRow[], hrefBase = '/manager/documents') =>
  renderToStaticMarkup(<ProposalsBlock rows={rows} hrefBase={hrefBase} />);

describe('ProposalsBlock', () => {
  it('строка читается целиком: номер, состояние, сумма, отправка и срок', () => {
    const out = html([ROW]);
    expect(out).toContain('КП-2026-12');
    expect(out).toContain('Отправлен');
    expect(out).toContain('отправлено 21.08.2026');
    expect(out).toContain('действует до 04.09.2026');
    expect(out).toContain('120');
  });

  it('ссылка ведёт в раздел документов своего кабинета', () => {
    // Увести руководителя в кабинет менеджера значило бы сломать «где я» (§15).
    expect(html([ROW], '/leader/documents')).toContain('href="/leader/documents/kp-1"');
  });

  it('незнакомое состояние печатается как есть, а не пропадает', () => {
    // Словарь статусов может отстать от базы; пустое место на месте состояния
    // хуже непонятного слова — по нему не поймёшь, что строка вообще про статус.
    expect(html([{ ...ROW, status: 'зверь-невиданный' }])).toContain('зверь-невиданный');
  });

  it('пустых мест нет: без номера, суммы и дат — понятные заглушки', () => {
    const out = html([{ ...ROW, number: null, amountGross: null, sentAt: null, validUntil: null }]);
    expect(out).toContain('без номера');
    expect(out).toContain('не отправлено');
    expect(out).toContain('без срока');
  });

  it('предложений нет — блока нет вовсе, а не пустой заголовок', () => {
    expect(html([])).toBe('');
  });
});
