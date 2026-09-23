import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listDirections,
  createDirection,
  updateDirection,
  deactivateDirection,
} from '@/lib/services/training/directions';

// Руководитель — самостоятельная top-level роль 'leader' (ТЗ 2026-08-17);
// переходной пары manager+managerRole больше нет.
function session(role: string) {
  return { sub: 'u1', role, companyId: 'c1' } as any;
}

const prisma = {
  trainingDirection: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('directions service', () => {
  it('listDirections возвращает активные по sortOrder', async () => {
    prisma.trainingDirection.findMany.mockResolvedValue([{ id: 'd1', name: 'ОТ' }]);
    const res = await listDirections(prisma, session('manager'));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.directions).toHaveLength(1);
    expect(prisma.trainingDirection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })
    );
  });

  it('createDirection запрещён менеджеру', async () => {
    const res = await createDirection(prisma, session('manager'), { name: 'X' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(prisma.trainingDirection.create).not.toHaveBeenCalled();
  });

  it('createDirection разрешён руководителю', async () => {
    prisma.trainingDirection.create.mockResolvedValue({ id: 'd2', name: 'X' });
    const res = await createDirection(prisma, session('leader'), { name: 'X' });
    expect(res.ok).toBe(true);
  });

  it('createDirection разрешён админу, пустое имя → validation', async () => {
    const res = await createDirection(prisma, session('admin'), { name: '  ' });
    expect(res).toEqual({ ok: false, error: 'validation' });
  });

  it('deactivateDirection ставит isActive=false', async () => {
    prisma.trainingDirection.update.mockResolvedValue({ id: 'd1', isActive: false });
    const res = await deactivateDirection(prisma, session('admin'), { id: 'd1' });
    expect(res.ok).toBe(true);
    expect(prisma.trainingDirection.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { isActive: false },
    });
  });
});

// Прогон сопровождения №37: ошибки базы по коду и по id — это ответы с кодом,
// а не падение сервера (500).
describe('directions service — ошибки базы', () => {
  const p2002 = (target: unknown) =>
    Object.assign(new Error('unique'), { code: 'P2002', meta: { target } });
  const p2025 = () => Object.assign(new Error('missing'), { code: 'P2025' });

  it('createDirection: занятый slug → slug_taken', async () => {
    prisma.trainingDirection.create.mockRejectedValue(p2002(['slug']));
    const res = await createDirection(prisma, session('admin'), { name: 'ОТ', slug: 'ot' });
    expect(res).toEqual({ ok: false, error: 'slug_taken' });
  });

  it('createDirection: чужое ограничение и прочие сбои пробрасываются', async () => {
    prisma.trainingDirection.create.mockRejectedValue(p2002(['name']));
    await expect(createDirection(prisma, session('admin'), { name: 'ОТ' })).rejects.toThrow(
      'unique'
    );
    prisma.trainingDirection.create.mockRejectedValue(new Error('db down'));
    await expect(createDirection(prisma, session('admin'), { name: 'ОТ' })).rejects.toThrow(
      'db down'
    );
  });

  it('updateDirection: направления нет → not_found, прочий сбой пробрасывается', async () => {
    prisma.trainingDirection.update.mockRejectedValue(p2025());
    expect(await updateDirection(prisma, session('admin'), { id: 'gone', name: 'X' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    prisma.trainingDirection.update.mockRejectedValue(new Error('db down'));
    await expect(updateDirection(prisma, session('admin'), { id: 'd1' })).rejects.toThrow(
      'db down'
    );
  });

  it('deactivateDirection: направления нет → not_found, прочий сбой пробрасывается', async () => {
    prisma.trainingDirection.update.mockRejectedValue(p2025());
    expect(await deactivateDirection(prisma, session('admin'), { id: 'gone' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    // null — тоже «прочий сбой»: разбор ошибки не должен на нём падать.
    prisma.trainingDirection.update.mockRejectedValue(null);
    await expect(deactivateDirection(prisma, session('admin'), { id: 'd1' })).rejects.toBeNull();
  });
});
