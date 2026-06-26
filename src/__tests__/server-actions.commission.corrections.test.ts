import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSession, resolveCorrection, revalidatePath } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  resolveCorrection: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/services/commission/corrections', () => ({ resolveCorrection }));

import { resolveCorrectionAction } from '@/server-actions/commission/corrections';

function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ sub: 'admin-1', role: 'admin' });
});

describe('resolveCorrectionAction', () => {
  it('apply action: returns ok and revalidates both queue paths', async () => {
    resolveCorrection.mockResolvedValue({ ok: true });

    const res = await resolveCorrectionAction(fd({ correctionId: 'c-1', action: 'apply' }));

    expect(res).toEqual({ ok: true });
    expect(resolveCorrection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sub: 'admin-1' }),
      { correctionId: 'c-1', action: 'apply', reason: undefined }
    );
    expect(revalidatePath).toHaveBeenCalledWith('/admin/commission-corrections');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/commission-corrections');
  });

  it('unknown action returns validation error without calling the service', async () => {
    const res = await resolveCorrectionAction(fd({ correctionId: 'c-1', action: 'bogus' }));

    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(resolveCorrection).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('passes through service failure (reason_required) without revalidating', async () => {
    resolveCorrection.mockResolvedValue({ ok: false, error: 'reason_required' });

    const res = await resolveCorrectionAction(fd({ correctionId: 'c-1', action: 'waive' }));

    expect(res).toEqual({ ok: false, error: 'reason_required' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
