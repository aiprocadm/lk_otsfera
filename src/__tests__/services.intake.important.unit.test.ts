import { describe, it, expect, vi } from 'vitest';

/**
 * «Важное» (`У-318`): сбой журнала не отменяет уже поставленную пометку
 * (§3 — побочное не блокирует основное), но пишется в лог.
 */
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { warn, error: vi.fn(), info: vi.fn() } }));

import { setIntakeImportant } from '@/lib/services/intake/important';

const session = { sub: 'm1', role: 'manager', companyId: 'c1' } as never;

describe('setIntakeImportant — сбой журнала', () => {
  it('пометка остаётся, ответ «ок», сбой — в лог (и текстом, и не-ошибкой)', async () => {
    const prisma = {
      inboundMessage: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      call: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    } as never;
    recordAudit.mockRejectedValueOnce(new Error('db down'));
    expect(
      await setIntakeImportant(prisma, session, { type: 'inbound', id: 'i1', important: true })
    ).toEqual({ ok: true });
    expect(warn).toHaveBeenLastCalledWith('[intake/important] audit failed', {
      id: 'i1',
      error: 'db down',
    });
    recordAudit.mockRejectedValueOnce('странное');
    expect(
      await setIntakeImportant(prisma, session, { type: 'call', id: 'c1', important: false })
    ).toEqual({ ok: true });
    expect(warn).toHaveBeenLastCalledWith('[intake/important] audit failed', {
      id: 'c1',
      error: 'странное',
    });
  });

  it('сотрудник без компании: звонок ищется в общей корзине, а не «везде»', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = { call: { updateMany } } as never;
    expect(
      await setIntakeImportant(prisma, { sub: 'm1', role: 'manager' } as never, {
        type: 'call',
        id: 'c1',
        important: true,
      })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(JSON.stringify(updateMany.mock.calls[0]![0].where)).toContain('__no_company__');
  });
});
