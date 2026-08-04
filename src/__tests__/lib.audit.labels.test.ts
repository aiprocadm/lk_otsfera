import { describe, it, expect, vi, afterEach } from 'vitest';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '@/lib/auth/audit';
import {
  AUDIT_TABLE_HEADERS,
  auditActionLabel,
  auditEntityLabel,
  auditFieldLabel,
  auditStatusLabel,
  formatAuditDateTime,
} from '@/lib/audit/labels';
import { log } from '@/lib/logging';

/**
 * Полнота словаря журнала аудита (ТЗ §6.4.2). Это защита на будущее: добавили
 * новое событие — тест падает, пока для него не написано русское название.
 * Prisma держит `action`/`entity` свободными строками, поэтому единственный
 * проверяемый источник — рантайм-реестры в `lib/auth/audit`.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

const CYRILLIC = /[А-Яа-яЁё]/;

describe('полнота словаря', () => {
  it('у каждого действия из реестра есть русское название', () => {
    const missing = AUDIT_ACTIONS.filter((a) => auditActionLabel(a) === a);
    expect(missing).toEqual([]);
  });

  it('у каждой сущности из реестра есть русское название', () => {
    const missing = AUDIT_ENTITIES.filter((e) => auditEntityLabel(e) === e);
    expect(missing).toEqual([]);
  });

  it('названия действительно на русском, а не переписанные латиницей коды', () => {
    for (const a of AUDIT_ACTIONS) expect(auditActionLabel(a)).toMatch(CYRILLIC);
    for (const e of AUDIT_ENTITIES) expect(auditEntityLabel(e)).toMatch(CYRILLIC);
  });

  it('реестры без дублей', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    expect(new Set(AUDIT_ENTITIES).size).toBe(AUDIT_ENTITIES.length);
  });

  it('заголовки колонок и статусы — на русском', () => {
    for (const header of Object.values(AUDIT_TABLE_HEADERS)) expect(header).toMatch(CYRILLIC);
    expect(auditStatusLabel('success')).toBe('Успешно');
    expect(auditStatusLabel('denied')).toBe('Отказано в доступе');
    expect(auditStatusLabel('error')).toBe('Ошибка');
  });
});

describe('поведение при пробеле в словаре', () => {
  it('неизвестное действие отдаётся как есть и попадает в лог', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    expect(auditActionLabel('never_seen_action')).toBe('never_seen_action');
    expect(warn).toHaveBeenCalled();
  });

  it('неизвестная сущность отдаётся как есть и попадает в лог', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    expect(auditEntityLabel('never_seen_entity')).toBe('never_seen_entity');
    expect(warn).toHaveBeenCalled();
  });

  it('неизвестный статус отдаётся как есть и попадает в лог', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    expect(auditStatusLabel('weird')).toBe('weird');
    expect(warn).toHaveBeenCalled();
  });
});

describe('названия полей диффа', () => {
  it('известные поля переводятся', () => {
    expect(auditFieldLabel('commissionRate')).toBe('Ставка комиссии');
    expect(auditFieldLabel('isActive')).toBe('Активен');
  });

  it('незнакомое поле остаётся как есть и в лог НЕ пишется (это данные)', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    expect(auditFieldLabel('someInternalKey')).toBe('someInternalKey');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('формат даты', () => {
  it('ДД.ММ.ГГГГ ЧЧ:ММ:СС без запятой', () => {
    const formatted = formatAuditDateTime(new Date('2026-08-04T09:05:07Z'));
    expect(formatted).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/);
    expect(formatted).toContain('04.08.2026');
  });
});
