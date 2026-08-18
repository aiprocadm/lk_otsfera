/**
 * F1 (parity) — unit-проверка ужесточённой zod-схемы `color` в обоих
 * настраиваемых CRUD-сервисах: строгий `#RRGGBB` (6 hex-цифр) или null/undefined.
 * Валидация срабатывает ДО обращения к prisma (safeParse после роль-гейта),
 * поэтому невалидные кейсы гоняются на пустом объекте; валидные — на tx-фейке
 * (паттерн cov.tasks.test.ts). Файл PURE — без конструирования реального
 * Prisma-клиента (иначе маркер-детектор vitest.config отнёс бы его к integration).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAuditMock } = vi.hoisted(() => ({ recordAuditMock: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));

import { createFunnelStage, type FunnelStageInput } from '@/lib/services/access/funnelStages';
import { createTaskColumn, type TaskColumnInput } from '@/lib/services/tasks/columns';

const leaderA = (): SessionPayload =>
  ({
    sub: 'l1',
    role: 'leader',
    companyId: 'co-A',
  }) as unknown as SessionPayload;

/** Prisma fake that runs a $transaction callback against the supplied `tx`. */
function txRuns(tx: unknown): PrismaClient {
  return {
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaClient;
}

beforeEach(() => vi.clearAllMocks());

const INVALID_COLORS = ['#ZZZZZZ', '#FFF', '22C55E', '#22C55E0', 'red'];

describe('funnelStages — color schema', () => {
  const input = (color: FunnelStageInput['color']): FunnelStageInput => ({
    name: 'Стадия',
    position: 0,
    statusAnchor: 'new',
    color,
  });

  it.each(INVALID_COLORS)(
    'невалидный color %s → validation до обращения к prisma',
    async (color) => {
      const r = await createFunnelStage({} as unknown as PrismaClient, leaderA(), input(color));
      expect(r).toEqual({ ok: false, error: 'validation' });
    }
  );

  it('валидный #22C55E → ok, цвет уходит в insert', async () => {
    const create = vi.fn().mockResolvedValue({ id: 's1' });
    const r = await createFunnelStage(
      txRuns({ funnelStage: { create } }),
      leaderA(),
      input('#22C55E')
    );
    expect(r).toEqual({ ok: true, id: 's1' });
    expect(create.mock.calls[0][0].data.color).toBe('#22C55E');
  });

  it.each([null, undefined])('color=%s → ok, в insert уходит null', async (color) => {
    const create = vi.fn().mockResolvedValue({ id: 's1' });
    const r = await createFunnelStage(txRuns({ funnelStage: { create } }), leaderA(), input(color));
    expect(r).toEqual({ ok: true, id: 's1' });
    expect(create.mock.calls[0][0].data.color).toBeNull();
  });
});

describe('tasks/columns — color schema', () => {
  const input = (color: TaskColumnInput['color']): TaskColumnInput => ({
    name: 'Колонка',
    position: 0,
    statusAnchor: 'todo',
    color,
  });

  it.each(INVALID_COLORS)(
    'невалидный color %s → validation до обращения к prisma',
    async (color) => {
      const r = await createTaskColumn({} as unknown as PrismaClient, leaderA(), input(color));
      expect(r).toEqual({ ok: false, error: 'validation' });
    }
  );

  it('валидный #22C55E → ok, цвет уходит в insert', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'c1' });
    const r = await createTaskColumn(
      txRuns({ taskColumn: { create } }),
      leaderA(),
      input('#22C55E')
    );
    expect(r).toEqual({ ok: true, id: 'c1' });
    expect(create.mock.calls[0][0].data.color).toBe('#22C55E');
  });

  it.each([null, undefined])('color=%s → ok, в insert уходит null', async (color) => {
    const create = vi.fn().mockResolvedValue({ id: 'c1' });
    const r = await createTaskColumn(txRuns({ taskColumn: { create } }), leaderA(), input(color));
    expect(r).toEqual({ ok: true, id: 'c1' });
    expect(create.mock.calls[0][0].data.color).toBeNull();
  });
});
