import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listDirections,
  createDirection,
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
