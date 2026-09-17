import { describe, it, expect } from 'vitest';
import {
  NOTIFICATION_TYPES,
  notificationTypesForRole,
  type NotificationRoleKey,
} from '@/lib/notifications/registry';

/**
 * СТРАЖ `У-233`: реестр ↔ фильтр страницы «Уведомления».
 *
 * У каждого типа обязаны быть русская подпись и значок — иначе в ленте
 * появится строка с машинным ключом вместо слов или пустое место вместо
 * знака, и человек решит, что раздел сломан. Фильтр страницы строится не из
 * списка в компоненте, а из реестра ПО РОЛИ: партнёр не увидит `sla_escalation`
 * даже в выпадающем списке, слушатель не увидит ничего (пакет §8).
 *
 * Мутация (проверено 17.09.2026): удалить `icon` у одного типа → красный
 * (плюс не собирается: поле обязательное); дать слушателю аудиторию `staff`
 * → красный.
 */

const ROLES: NotificationRoleKey[] = [
  'admin',
  'leader',
  'manager',
  'partner',
  'organization',
  'student',
];

describe('страж: реестр ↔ фильтр страницы', () => {
  it('у каждого типа есть непустая русская подпись и значок', () => {
    for (const [key, spec] of Object.entries(NOTIFICATION_TYPES)) {
      expect(spec.label.trim().length, `подпись у ${key}`).toBeGreaterThan(0);
      expect(/[А-Яа-яЁё]/.test(spec.label), `подпись ${key} по-русски`).toBe(true);
      expect(spec.icon.trim().length, `значок у ${key}`).toBeGreaterThan(0);
      // Значок — один знак, не слово: это пометка строки, а не вторая подпись.
      expect([...spec.icon].length, `значок ${key} — один символ`).toBeLessThanOrEqual(2);
    }
  });

  it('фильтр каждой роли — подмножество реестра, без чужих типов', () => {
    const all = new Set(Object.keys(NOTIFICATION_TYPES));
    for (const role of ROLES) {
      for (const key of notificationTypesForRole(role)) {
        expect(all.has(key), `${role}: ${key} есть в реестре`).toBe(true);
      }
    }
  });

  it('партнёр и заказчик не видят служебных типов сотрудников', () => {
    for (const role of ['partner', 'organization'] as const) {
      const keys = notificationTypesForRole(role);
      expect(keys).not.toContain('sla_escalation');
      expect(keys).not.toContain('sync_error');
      expect(keys).not.toContain('ops_alert');
      expect(keys.length).toBeGreaterThan(0);
    }
  });

  it('руководитель получает всё менеджерское — рассылки идут контуру без разбора должности', () => {
    const leader = new Set(notificationTypesForRole('leader'));
    for (const key of notificationTypesForRole('manager')) {
      expect(leader.has(key), `${key} у руководителя`).toBe(true);
    }
  });

  it('слушателю не адресован ни один тип — его фильтр пуст, страница всегда пустая (`Р-Э5-1`)', () => {
    expect(notificationTypesForRole('student')).toEqual([]);
  });

  it('фильтр не дублирует типы и идёт в порядке реестра', () => {
    const order = Object.keys(NOTIFICATION_TYPES);
    for (const role of ROLES) {
      const keys = notificationTypesForRole(role);
      expect(new Set(keys).size).toBe(keys.length);
      const positions = keys.map((k) => order.indexOf(k));
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    }
  });
});
