/**
 * Unit tests for src/lib/services/manager/teamVisibility.ts
 * Covers the company_not_found branch (Result) that is not in the existing test.
 */
import { describe, it, expect, vi } from 'vitest';
import { setTeamVisibility } from '@/lib/services/manager/teamVisibility';

describe('setTeamVisibility — additional branch', () => {
  it('returns company_not_found when company does not exist', async () => {
    const prisma = {
      company: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    } as unknown as Parameters<typeof setTeamVisibility>[0];

    const res = await setTeamVisibility(prisma, 'actor-1', 'co-nonexistent', true);

    expect(res).toEqual({ ok: false, error: 'company_not_found' });
    expect(prisma.company.update as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});
