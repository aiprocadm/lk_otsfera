import { describe, expect, it } from 'vitest';

import { BitrixRegistry, isPlanned, plannedId } from '@/lib/services/bitrix/mapping/registry';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-191`): реестр «что уже есть и что появится» на время
 * одного прогона. В сухом прогоне организации ещё нет в базе, поэтому вместо
 * настоящего идентификатора реестр помнит метку `planned:*` — иначе сделка
 * честно получила бы «нет организации», и предпросмотр показал бы картину,
 * которой не будет.
 */

describe('plannedId — метка запланированной строки', () => {
  it.each([
    ['organization', '7', 'planned:organization:7'],
    ['contact', '42', 'planned:contact:42'],
    ['deal', 'C7:99', 'planned:deal:C7:99'],
  ] as const)('сущность «%s», запись «%s» → «%s»', (entity, bitrixId, expected) => {
    expect(plannedId(entity, bitrixId)).toBe(expected);
  });
});

describe('isPlanned — метка или настоящий идентификатор', () => {
  it.each([
    ['метка реестра', 'planned:organization:7', true],
    ['метка другой сущности', 'planned:contact:1', true],
    ['настоящий cuid', 'ckv9x1a2b0000qzrmn831i7rn', false],
    ['пустая строка', '', false],
    ['слово planned без двоеточия', 'plannedorganization', false],
    ['метка в середине строки', 'org-planned:contact:1', false],
    ['null', null, false],
    ['undefined', undefined, false],
  ] as const)('%s → %s', (_name, id, expected) => {
    expect(isPlanned(id)).toBe(expected);
  });
});

describe('BitrixRegistry', () => {
  it('plan возвращает метку и запоминает её', () => {
    const registry = new BitrixRegistry();
    const id = registry.plan('organization', '7');
    expect(id).toBe('planned:organization:7');
    expect(registry.get('organization', '7')).toBe('planned:organization:7');
    expect(isPlanned(registry.get('organization', '7'))).toBe(true);
  });

  it('set кладёт настоящий идентификатор и перезаписывает метку', () => {
    // Так writer в `live` заменяет метку сразу после создания строки.
    const registry = new BitrixRegistry();
    registry.plan('organization', '7');
    registry.set('organization', '7', 'org-1');
    expect(registry.get('organization', '7')).toBe('org-1');
    expect(isPlanned(registry.get('organization', '7'))).toBe(false);
    expect(registry.size('organization')).toBe(1);
  });

  it('set перезаписывает и настоящий идентификатор', () => {
    const registry = new BitrixRegistry();
    registry.set('contact', '1', 'c-old');
    registry.set('contact', '1', 'c-new');
    expect(registry.get('contact', '1')).toBe('c-new');
  });

  it('get неизвестной записи → undefined', () => {
    const registry = new BitrixRegistry();
    registry.set('organization', '7', 'org-1');
    expect(registry.get('organization', '8')).toBeUndefined();
    // И у сущности, которой ещё никто не касался, тоже нет записей.
    expect(registry.get('deal', '7')).toBeUndefined();
  });

  it('сущности не смешиваются: один и тот же id портала живёт в каждой отдельно', () => {
    const registry = new BitrixRegistry();
    registry.set('organization', '7', 'org-1');
    registry.set('contact', '7', 'c-1');
    expect(registry.get('organization', '7')).toBe('org-1');
    expect(registry.get('contact', '7')).toBe('c-1');
    expect(registry.size('organization')).toBe(1);
    expect(registry.size('contact')).toBe(1);
  });

  it('keys перечисляет идентификаторы Битрикса в порядке добавления', () => {
    const registry = new BitrixRegistry();
    registry.set('organization', '7', 'org-1');
    registry.plan('organization', '9');
    registry.set('organization', '8', 'org-2');
    expect(registry.keys('organization')).toEqual(['7', '9', '8']);
    expect(registry.keys('contact')).toEqual([]);
  });

  it('повтор того же id не удваивает ни keys, ни size', () => {
    const registry = new BitrixRegistry();
    registry.plan('contact', '1');
    registry.plan('contact', '1');
    registry.set('contact', '1', 'c-1');
    expect(registry.keys('contact')).toEqual(['1']);
    expect(registry.size('contact')).toBe(1);
  });

  it('size пустой сущности — ноль', () => {
    const registry = new BitrixRegistry();
    expect(registry.size('file')).toBe(0);
  });

  it('два реестра независимы — прогон не видит чужих записей', () => {
    const first = new BitrixRegistry();
    const second = new BitrixRegistry();
    first.set('organization', '7', 'org-1');
    expect(second.get('organization', '7')).toBeUndefined();
    expect(second.size('organization')).toBe(0);
  });
});
