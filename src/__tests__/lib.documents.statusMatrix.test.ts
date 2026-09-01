import { describe, it, expect } from 'vitest';
import type { DocumentStatus } from '@prisma/client';
import {
  LIFECYCLE_TYPES,
  STATUS_LABELS,
  STATUS_TRANSITIONS,
  canTransition,
  isFinalStatus,
  isLifecycleType,
} from '@/lib/documents/statusMatrix';

/**
 * `У-148` — матрица переходов статусов документа.
 *
 * Матрица существует ровно затем, чтобы документ не получил состояние,
 * которого по бумаге быть не может: аннулированный счёт «оплачивается»,
 * принятый акт «отправляется заново». Проверяем именно запреты — разрешения
 * без них ничего не значат.
 */
const ALL_STATUSES: DocumentStatus[] = [
  'draft',
  'issued',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
];

describe('матрица переходов документа', () => {
  it('покрывает каждый тип с жизненным циклом и каждый статус', () => {
    for (const type of LIFECYCLE_TYPES) {
      for (const status of ALL_STATUSES) {
        expect(STATUS_TRANSITIONS[type][status], `${type}/${status}`).toBeDefined();
      }
    }
  });

  it('обычный путь счёта: выставлен → отправлен → принят', () => {
    expect(canTransition('invoice', 'issued', 'sent')).toBe(true);
    expect(canTransition('invoice', 'sent', 'accepted')).toBe(true);
  });

  it('принять можно и сразу после выпуска — акт подписывают на бумаге', () => {
    expect(canTransition('act', 'issued', 'accepted')).toBe(true);
  });

  it('назад дороги нет: принятый документ никуда не уходит', () => {
    for (const to of ALL_STATUSES) {
      expect(canTransition('act', 'accepted', to), `accepted → ${to}`).toBe(false);
    }
    expect(isFinalStatus('act', 'accepted')).toBe(true);
  });

  it('аннулированный документ не воскресает', () => {
    for (const to of ALL_STATUSES) {
      expect(canTransition('contract', 'cancelled', to), `cancelled → ${to}`).toBe(false);
    }
  });

  it('аннулировать можно с любого рабочего состояния, но не с конечного', () => {
    expect(canTransition('invoice', 'issued', 'cancelled')).toBe(true);
    expect(canTransition('invoice', 'sent', 'cancelled')).toBe(true);
    expect(canTransition('invoice', 'accepted', 'cancelled')).toBe(false);
  });

  it('«отклонён» и «истёк» — состояния КП, счетам и актам они недоступны', () => {
    // Перебор по списку, а не по трём литералам: появится пятый тип с
    // жизненным циклом — он попадёт под проверку сам. Исключение ровно одно и
    // названо по имени, потому что оно и есть смысл требования.
    for (const type of LIFECYCLE_TYPES) {
      if (type === 'commercial_proposal') continue;
      for (const from of ALL_STATUSES) {
        expect(canTransition(type, from, 'rejected'), `${type}: ${from} → rejected`).toBe(false);
        expect(canTransition(type, from, 'expired'), `${type}: ${from} → expired`).toBe(false);
      }
    }
  });

  it('КП уходит из ЧЕРНОВИКА сразу в «отправлено» — состояния «выставлен» у него нет', () => {
    // Единственный тип, который не выпускается сразу (`У-164`). Выставить
    // предложение и не отправить его бессмысленно: бумага существует ради
    // отправки.
    expect(canTransition('commercial_proposal', 'draft', 'sent')).toBe(true);
    expect(canTransition('commercial_proposal', 'draft', 'issued')).toBe(false);
  });

  it('«выставлен» у КП недостижим и с той, и с другой стороны', () => {
    // Проверяем обе стороны: состояние, в которое нельзя попасть, но из
    // которого можно уйти, — это ловушка для будущей правки. Пустой список
    // переходов делает его конечным, а значит безвредным, даже если кто-то
    // запишет его в базу руками.
    for (const from of ALL_STATUSES) {
      expect(
        canTransition('commercial_proposal', from, 'issued'),
        `commercial_proposal: ${from} → issued`
      ).toBe(false);
    }
    expect(isFinalStatus('commercial_proposal', 'issued')).toBe(true);
  });

  it('отклонить и дать истечь можно только ОТПРАВЛЕННОЕ предложение', () => {
    // Отклонённый черновик означал бы, что клиент отказался от того, чего не
    // видел.
    expect(canTransition('commercial_proposal', 'sent', 'rejected')).toBe(true);
    expect(canTransition('commercial_proposal', 'sent', 'expired')).toBe(true);
    for (const from of ALL_STATUSES) {
      if (from === 'sent') continue;
      expect(
        canTransition('commercial_proposal', from, 'rejected'),
        `commercial_proposal: ${from} → rejected`
      ).toBe(false);
      expect(
        canTransition('commercial_proposal', from, 'expired'),
        `commercial_proposal: ${from} → expired`
      ).toBe(false);
    }
  });

  it('отказ и истечение конечны: передумавший клиент получает НОВОЕ предложение', () => {
    // Воскрешать старое нельзя — срок напечатан в бумаге, которая уже у
    // клиента на руках. Для «давайте ещё раз» есть перевыпуск (`У-151`).
    for (const status of ['rejected', 'expired'] as const) {
      for (const to of ALL_STATUSES) {
        expect(
          canTransition('commercial_proposal', status, to),
          `commercial_proposal: ${status} → ${to}`
        ).toBe(false);
      }
      expect(isFinalStatus('commercial_proposal', status)).toBe(true);
    }
  });

  it('аннулировать КП можно из черновика и из отправленного, но не после ответа клиента', () => {
    expect(canTransition('commercial_proposal', 'draft', 'cancelled')).toBe(true);
    expect(canTransition('commercial_proposal', 'sent', 'cancelled')).toBe(true);
    expect(canTransition('commercial_proposal', 'accepted', 'cancelled')).toBe(false);
    expect(canTransition('commercial_proposal', 'rejected', 'cancelled')).toBe(false);
  });

  it('файлы без жизненного цикла матрицей не управляются', () => {
    expect(isLifecycleType('invoice')).toBe(true);
    expect(isLifecycleType('other')).toBe(false);
    expect(isLifecycleType('report')).toBe(false);
    expect(isLifecycleType('certificate')).toBe(false);
  });

  it('у каждого статуса есть русское название (§15)', () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_LABELS[status], status).toMatch(/[а-яА-ЯёЁ]/);
    }
  });
});
