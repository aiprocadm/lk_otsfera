import { describe, it, expect, vi } from 'vitest';
import { setTeamVisibility } from '@/lib/services/manager/teamVisibility';

function makePrisma(current: boolean) {
  return {
    company: {
      findUnique: vi.fn().mockResolvedValue({ managerTeamVisibility: current }),
      update: vi.fn().mockResolvedValue({}),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as Parameters<typeof setTeamVisibility>[0];
}

describe('setTeamVisibility', () => {
  it('flips OFF→ON, writes audit, reports changed', async () => {
    const prisma = makePrisma(false);
    const res = await setTeamVisibility(prisma, 'actor-1', 'co-1', true);
    expect(res).toEqual({ ok: true, changed: true });
    expect(prisma.company.update as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
      where: { id: 'co-1' },
      data: { managerTeamVisibility: true },
    });
    expect(prisma.auditLog.create as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
  });

  it('is a no-op when already in target state (no audit, changed=false)', async () => {
    const prisma = makePrisma(true);
    const res = await setTeamVisibility(prisma, 'actor-1', 'co-1', true);
    expect(res).toEqual({ ok: true, changed: false });
    expect(prisma.company.update as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(prisma.auditLog.create as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});
