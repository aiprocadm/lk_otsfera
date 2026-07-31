/**
 * §11 ТЗ v0.5, этап 1 PR-2 — сборка данных экрана настройки полей.
 * Unit-уровень: Prisma не нужен, `listDefinitions` мокается.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { listDefinitions, getActiveDefinitions } = vi.hoisted(() => ({
  listDefinitions: vi.fn(),
  // getFieldsForEntity ходит сюда через getValuesForEntity — без этого мока
  // тест падает на «No export is defined».
  getActiveDefinitions: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/services/customFields/definitions', () => ({
  listDefinitions,
  getActiveDefinitions,
}));

import {
  parseEntityParam,
  getCustomFieldsScreen,
  DEFAULT_ENTITY,
} from '@/lib/services/customFields/screen';
import { getFieldsForEntity } from '@/lib/services/customFields/values';

const prisma = {} as PrismaClient;
const session = { sub: 'a1', role: 'admin' } as SessionPayload;

describe('parseEntityParam', () => {
  it('принимает все пять сущностей', () => {
    for (const e of ['order', 'organization', 'partner', 'student', 'document']) {
      expect(parseEntityParam(e)).toBe(e);
    }
  });

  it('мусор, пусто и массив приводятся к заявке', () => {
    expect(parseEntityParam('invoice')).toBe(DEFAULT_ENTITY);
    expect(parseEntityParam(undefined)).toBe(DEFAULT_ENTITY);
    expect(parseEntityParam([])).toBe(DEFAULT_ENTITY);
  });

  it('из массива берётся первое значение (Next отдаёт так при дубле параметра)', () => {
    expect(parseEntityParam(['partner', 'order'])).toBe('partner');
    expect(parseEntityParam(['bogus'])).toBe(DEFAULT_ENTITY);
  });
});

describe('getCustomFieldsScreen', () => {
  beforeEach(() => {
    listDefinitions.mockReset();
  });

  it('отдаёт определения и системные поля выбранной сущности', async () => {
    listDefinitions.mockResolvedValue({ ok: true, rows: [{ id: 'd1' }] });

    const screen = await getCustomFieldsScreen(prisma, session, 'organization');

    expect(listDefinitions).toHaveBeenCalledWith(prisma, session, 'organization');
    expect(screen.entity).toBe('organization');
    expect(screen.definitions).toEqual([{ id: 'd1' }]);
    expect(screen.systemFields.map((f) => f.key)).toEqual([
      'name',
      'org_type',
      'partner',
      'assigned_manager',
      'status',
    ]);
  });

  it('у заявки системных полей нет', async () => {
    listDefinitions.mockResolvedValue({ ok: true, rows: [] });
    const screen = await getCustomFieldsScreen(prisma, session, undefined);
    expect(screen.entity).toBe('order');
    expect(screen.systemFields).toEqual([]);
  });

  it('отказ сервиса даёт пустой список, а не исключение', async () => {
    listDefinitions.mockResolvedValue({ ok: false, error: 'forbidden' });
    const screen = await getCustomFieldsScreen(prisma, session, 'partner');
    expect(screen.definitions).toEqual([]);
    expect(screen.entity).toBe('partner');
  });
});

describe('getFieldsForEntity — обёртка для страниц', () => {
  beforeEach(() => {
    listDefinitions.mockReset();
  });

  it('успех отдаёт массив полей', async () => {
    listDefinitions.mockResolvedValue({ ok: true, rows: [] });
    const fields = await getFieldsForEntity(prisma, session, 'organization', 'o1');
    expect(Array.isArray(fields)).toBe(true);
  });

  it('неизвестная сущность даёт пустой массив, а не падение страницы', async () => {
    const fields = await getFieldsForEntity(prisma, session, 'invoice', 'o1');
    expect(fields).toEqual([]);
  });
});
