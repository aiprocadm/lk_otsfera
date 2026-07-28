import { describe, it, expect } from 'vitest';
import {
  NOTIFICATION_TYPES,
  isKnownNotificationType,
  notificationLabelRu,
  notificationTypesFor
} from '@/lib/notifications/registry';

/**
 * Этап 11 PR-3 (ФТ-15.7) — единый реестр типов уведомлений.
 * Реестр — контракт кода: подписи на русском, аудитория известна, неизвестный
 * тип не роняет экран.
 */

describe('NOTIFICATION_TYPES', () => {
  it('покрывает все восемь типов, названных ФТ-15.7', () => {
    // `new_client_request` из ТЗ реализован как `client_request_submitted`
    // (см. комментарий в реестре) — проверяем через псевдоним.
    const byTz = new Map(
      Object.entries(NOTIFICATION_TYPES).map(([key, spec]) => [
        (spec as { tzAlias?: string }).tzAlias ?? key,
        key
      ])
    );
    for (const tzType of [
      'new_client_request',
      'client_request_status_changed',
      'enrollment_status_changed',
      'task_assigned',
      'task_due_soon',
      'order_result_delivered',
      'sla_escalation',
      'requisites_requested'
    ]) {
      expect(byTz.has(tzType), `ФТ-15.7 требует тип ${tzType}`).toBe(true);
    }
  });

  it('псевдоним ТЗ ведёт на исторический код, а не подменяет его', () => {
    expect(NOTIFICATION_TYPES.client_request_submitted.tzAlias).toBe('new_client_request');
    expect(isKnownNotificationType('new_client_request')).toBe(false);
  });

  it('у каждого типа русская подпись, аудитория и файл-продьюсер', () => {
    for (const [key, spec] of Object.entries(NOTIFICATION_TYPES)) {
      expect(spec.label, key).toMatch(/[А-Яа-яЁё]/);
      expect(spec.audience.length, key).toBeGreaterThan(0);
      expect(spec.producer, key).toMatch(/^src\//);
    }
  });

  it('подписи не повторяются — иначе в списке два одинаковых уведомления', () => {
    const labels = Object.values(NOTIFICATION_TYPES).map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('notificationLabelRu', () => {
  it('отдаёт подпись известного типа', () => {
    expect(notificationLabelRu('order_result_delivered')).toBe('Результат по заказу передан');
  });

  it('неизвестный тип не прячется, а показывается кодом (fail-open)', () => {
    expect(notificationLabelRu('какой_то_новый')).toBe('какой_то_новый');
  });
});

describe('notificationTypesFor', () => {
  it('клиентские типы адресованы организации', () => {
    const forOrg = notificationTypesFor('organization');
    expect(forOrg).toContain('order_result_delivered');
    expect(forOrg).toContain('payment_received');
    expect(forOrg).not.toContain('comment_from_org');
  });

  it('менеджерские типы не утекают клиенту', () => {
    const forManager = notificationTypesFor('manager');
    expect(forManager).toContain('comment_from_org');
    expect(forManager).toContain('client_request_submitted');
  });

  it('аудитория без типов даёт пустой список, а не падение', () => {
    expect(notificationTypesFor('admin')).toEqual(['ops_alert']);
  });
});

describe('isKnownNotificationType', () => {
  it('различает известные и неизвестные типы', () => {
    expect(isKnownNotificationType('chat_message')).toBe(true);
    expect(isKnownNotificationType('nope')).toBe(false);
  });
});
