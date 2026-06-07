import { describe, expect, it, vi } from 'vitest';

import { recordAudit } from '@/lib/auth/audit';

describe('recordAudit()', () => {
  it('persists the new sync-control entities', async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = { auditLog: { create } } as unknown as import('@prisma/client').PrismaClient;
    await recordAudit(prisma, {
      userId: 'u1',
      action: 'sync_triggered',
      entity: 'sync_state',
      entityId: 'order',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entity: 'sync_state' }) })
    );
  });
});
