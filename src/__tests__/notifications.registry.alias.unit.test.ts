import { describe, it, expect } from 'vitest';
import {
  LEGACY_NOTIFICATION_TYPE_ALIASES,
  NOTIFICATION_TYPES,
  notificationLabelRu,
} from '@/lib/notifications/registry';

/**
 * Псевдоним прежнего типа уведомления (`У-183`, этап 1 ТЗ 12.09.2026, спека
 * docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §3.6).
 *
 * Заметки по сделке и по организации слились в один тип `note_mention`;
 * исторические строки `Notification.type = 'deal_note_mention'` в базе не
 * переименовывались, поэтому подпись для них берётся у нового типа, а самого
 * старого ключа в реестре быть не должно — иначе он снова расползётся по коду.
 */
describe('псевдоним deal_note_mention → note_mention', () => {
  it('подпись старого типа совпадает с подписью нового', () => {
    expect(notificationLabelRu('deal_note_mention')).toBe('Упоминание в заметке');
    expect(notificationLabelRu('note_mention')).toBe('Упоминание в заметке');
    expect(notificationLabelRu('deal_note_mention')).toBe(notificationLabelRu('note_mention'));
  });

  it('неизвестный тип возвращается как есть (fail-open)', () => {
    expect(notificationLabelRu('nobody_knows_this')).toBe('nobody_knows_this');
  });

  it('таблица псевдонимов содержит ровно одну запись — deal_note_mention', () => {
    expect(LEGACY_NOTIFICATION_TYPE_ALIASES).toEqual({ deal_note_mention: 'note_mention' });
  });

  it('в реестре нет старого ключа, а новый ведёт на общий продьюсер заметок', () => {
    expect(Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, 'deal_note_mention')).toBe(
      false
    );
    expect(NOTIFICATION_TYPES.note_mention).toMatchObject({
      label: 'Упоминание в заметке',
      producer: 'src/lib/notifications/noteMention.ts',
    });
  });
});
