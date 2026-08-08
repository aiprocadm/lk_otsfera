/**
 * Добор покрытия роутов настраиваемых полей: проверяем контракт передачи
 * НЕОБЯЗАТЕЛЬНЫХ полей тела в сервис.
 *
 * Роуты собраны под `exactOptionalPropertyTypes`: ключа, которого не было в
 * теле запроса, в аргументах сервиса быть НЕ должно (иначе Prisma поймёт
 * `undefined` как «затереть значение»). Существующие тесты
 * (api.admin.customFields.test.ts) шлют только обязательный минимум, поэтому
 * ветка «поле есть в теле» ни разу не исполнялась.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession, requireFieldsAdmin } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireFieldsAdmin: vi.fn(),
}));
const { createDefinition, updateDefinition, deactivateDefinition } = vi.hoisted(() => ({
  createDefinition: vi.fn(),
  updateDefinition: vi.fn(),
  deactivateDefinition: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireSession, requireFieldsAdmin }));
vi.mock('@/lib/services/customFields', () => ({
  createDefinition,
  updateDefinition,
  deactivateDefinition,
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { POST } from '@/app/api/admin/custom-fields/route';
import { PATCH } from '@/app/api/admin/custom-fields/[id]/route';

const adminSession = { sub: 'admin-1', role: 'admin' };

const routeCtx = { params: Promise.resolve({}) };

function idCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** Аргументы сервиса (третий/четвёртый параметр) из последнего вызова мока. */
function lastArgs(mock: ReturnType<typeof vi.fn>, index: number): Record<string, unknown> {
  const call = mock.mock.calls.at(-1);
  return call?.[index] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ ok: true, value: adminSession });
  requireFieldsAdmin.mockReturnValue({ ok: true, value: adminSession });
});

// ─── POST /api/admin/custom-fields ───────────────────────────────────────────

describe('POST /api/admin/custom-fields — необязательные поля тела', () => {
  it('передаёт сервису все необязательные поля, когда они есть в теле', async () => {
    createDefinition.mockResolvedValue({ ok: true, definition: { id: 'cf-full' } });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({
        entityType: 'order',
        key: 'city',
        label: 'Город',
        fieldType: 'select',
        options: ['Москва', 'Казань'],
        required: true,
        sortOrder: 7,
        helpText: 'Подсказка',
        visibleToRoles: ['admin', 'manager'],
        editableByRoles: ['admin'],
      }),
    });

    const res = await POST(req as Request, routeCtx);

    expect(res.status).toBe(201);
    expect(lastArgs(createDefinition, 1)).toBe(adminSession);
    const args = lastArgs(createDefinition, 2);
    expect(args).toEqual({
      entityType: 'order',
      key: 'city',
      label: 'Город',
      fieldType: 'select',
      options: ['Москва', 'Казань'],
      required: true,
      sortOrder: 7,
      helpText: 'Подсказка',
      visibleToRoles: ['admin', 'manager'],
      editableByRoles: ['admin'],
    });
  });

  it('helpText: null доходит до сервиса как null (сброс подсказки), а не отбрасывается', async () => {
    createDefinition.mockResolvedValue({ ok: true, definition: { id: 'cf-null' } });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({
        entityType: 'order',
        key: 'note',
        label: 'Заметка',
        fieldType: 'text',
        helpText: null,
      }),
    });

    const res = await POST(req as Request, routeCtx);

    expect(res.status).toBe(201);
    const args = lastArgs(createDefinition, 2);
    expect(Object.keys(args).sort()).toContain('helpText');
    expect(args.helpText).toBeNull();
  });

  it('не кладёт в аргументы ключи, которых не было в теле', async () => {
    createDefinition.mockResolvedValue({ ok: true, definition: { id: 'cf-min' } });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({
        entityType: 'order',
        key: 'plain',
        label: 'Простое',
        fieldType: 'text',
      }),
    });

    const res = await POST(req as Request, routeCtx);

    expect(res.status).toBe(201);
    expect(Object.keys(lastArgs(createDefinition, 2)).sort()).toEqual([
      'entityType',
      'fieldType',
      'key',
      'label',
    ]);
  });
});

// ─── Карта кодов сервиса в HTTP-статус (mapErr) ──────────────────────────────

describe('коды сервиса → HTTP-статус', () => {
  it('POST: not_found от сервиса → 404 с тем же кодом в теле', async () => {
    createDefinition.mockResolvedValue({ ok: false, error: 'not_found' });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ entityType: 'order', key: 'k', label: 'K', fieldType: 'text' }),
    });

    const res = await POST(req as Request, routeCtx);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not_found' });
  });

  it('PATCH: любой прочий код сервиса → 400 с тем же кодом в теле', async () => {
    updateDefinition.mockResolvedValue({ ok: false, error: 'invalid_entity_type' });
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ label: 'X' }),
    });

    const res = await PATCH(req as Request, idCtx('cf1'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_entity_type' });
  });
});

// ─── PATCH /api/admin/custom-fields/[id] ─────────────────────────────────────

describe('PATCH /api/admin/custom-fields/[id] — необязательные поля патча', () => {
  it('передаёт сервису все поля патча, когда они есть в теле', async () => {
    updateDefinition.mockResolvedValue({ ok: true, definition: { id: 'cf1' } });
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({
        label: 'Новое имя',
        options: ['A', 'B'],
        required: false,
        sortOrder: 3,
        isActive: true,
        helpText: null,
        visibleToRoles: ['admin'],
        editableByRoles: ['admin', 'manager'],
      }),
    });

    const res = await PATCH(req as Request, idCtx('cf1'));

    expect(res.status).toBe(200);
    expect(lastArgs(updateDefinition, 2)).toBe('cf1');
    expect(lastArgs(updateDefinition, 3)).toEqual({
      label: 'Новое имя',
      options: ['A', 'B'],
      required: false,
      sortOrder: 3,
      isActive: true,
      helpText: null,
      visibleToRoles: ['admin'],
      editableByRoles: ['admin', 'manager'],
    });
  });

  it('патч без label не отправляет ключ label (название остаётся прежним)', async () => {
    updateDefinition.mockResolvedValue({ ok: true, definition: { id: 'cf2', isActive: false } });
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ isActive: false }),
    });

    const res = await PATCH(req as Request, idCtx('cf2'));

    expect(res.status).toBe(200);
    expect(Object.keys(lastArgs(updateDefinition, 3))).toEqual(['isActive']);
  });
});
