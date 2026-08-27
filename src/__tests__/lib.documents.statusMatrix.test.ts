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
    for (const type of LIFECYCLE_TYPES) {
      for (const from of ALL_STATUSES) {
        expect(canTransition(type, from, 'rejected'), `${type}: ${from} → rejected`).toBe(false);
        expect(canTransition(type, from, 'expired'), `${type}: ${from} → expired`).toBe(false);
      }
    }
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
