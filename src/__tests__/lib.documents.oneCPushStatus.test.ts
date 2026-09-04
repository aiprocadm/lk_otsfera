import { describe, it, expect } from 'vitest';
import {
  ONE_C_PUSH_STATUS_LABEL,
  ONE_C_PUSH_STATUS_ORDER,
  ONE_C_PUSH_STATUS_TONE,
  parseOneCPushStatus,
} from '@/lib/documents/oneCPushStatus';

/**
 * `У-169`: один словарь состояний выгрузки в 1С на карточку, бейдж и фильтр.
 * Страж полноты: новый статус в `enum OneCPushStatus` обязан получить подпись,
 * цвет и место в порядке фильтра — иначе на экране появится машинное слово.
 */
describe('словарь состояний выгрузки в 1С', () => {
  const statuses = Object.keys(ONE_C_PUSH_STATUS_LABEL);

  it('у каждого статуса есть русская подпись, цвет и место в порядке фильтра', () => {
    expect(statuses.sort()).toEqual(
      ['none', 'pending', 'pushed', 'failed', 'skipped', 'exported_file'].sort()
    );
    for (const s of statuses) {
      expect(ONE_C_PUSH_STATUS_LABEL[s as keyof typeof ONE_C_PUSH_STATUS_LABEL]).toMatch(/[А-Яа-яЁё]/);
      expect(ONE_C_PUSH_STATUS_TONE[s as keyof typeof ONE_C_PUSH_STATUS_TONE]).toBeTruthy();
    }
    expect([...ONE_C_PUSH_STATUS_ORDER].sort()).toEqual(statuses.sort());
  });

  it('порядок фильтра начинается с того, что требует внимания — ошибки', () => {
    expect(ONE_C_PUSH_STATUS_ORDER[0]).toBe('failed');
  });

  it('ошибка — красная, очередь — жёлтая, выгружен — зелёный', () => {
    expect(ONE_C_PUSH_STATUS_TONE.failed).toBe('danger');
    expect(ONE_C_PUSH_STATUS_TONE.pending).toBe('warning');
    expect(ONE_C_PUSH_STATUS_TONE.pushed).toBe('success');
    expect(ONE_C_PUSH_STATUS_TONE.exported_file).toBe('success');
  });
});

describe('parseOneCPushStatus — значение из адресной строки', () => {
  it('известный статус возвращается как есть', () => {
    expect(parseOneCPushStatus('failed')).toBe('failed');
    expect(parseOneCPushStatus('exported_file')).toBe('exported_file');
  });

  it('пусто или чужое слово — «без фильтра», а не ошибка', () => {
    expect(parseOneCPushStatus(undefined)).toBeUndefined();
    expect(parseOneCPushStatus('')).toBeUndefined();
    expect(parseOneCPushStatus('nope')).toBeUndefined();
    // Служебные ключи объекта — не статусы.
    expect(parseOneCPushStatus('toString')).toBeUndefined();
    expect(parseOneCPushStatus('__proto__')).toBeUndefined();
  });
});
