import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireSession,
  revalidatePath,
  moveFunnelLead,
  createFunnelStage,
  updateFunnelStage,
  deleteFunnelStage,
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  moveFunnelLead: vi.fn(),
  createFunnelStage: vi.fn(),
  updateFunnelStage: vi.fn(),
  deleteFunnelStage: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/funnel/board', () => ({ moveFunnelLead }));
vi.mock('@/lib/services/access/funnelStages', () => ({
  createFunnelStage,
  updateFunnelStage,
  deleteFunnelStage,
}));

import {
  moveFunnelLeadAction,
  createFunnelStageAction,
  updateFunnelStageAction,
  deleteFunnelStageAction,
} from '@/server-actions/funnel';

const SESSION = { sub: 'u1', role: 'manager', managerRole: 'leader', companyId: 'co-A' };

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
  revalidatePath.mockReturnValue(undefined);
});

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe('moveFunnelLeadAction', () => {
  it('calls service, revalidates both cabinets on success', async () => {
    moveFunnelLead.mockResolvedValue({ ok: true });
    const res = await moveFunnelLeadAction(form({ leadId: 'l1', toStageId: 'default:in_review' }));
    expect(res).toEqual({ ok: true });
    expect(moveFunnelLead).toHaveBeenCalledWith({}, SESSION, {
      leadId: 'l1',
      toStageId: 'default:in_review',
      reason: undefined,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/leader/funnel');
    expect(revalidatePath).toHaveBeenCalledWith('/manager/funnel');
  });
  it('missing ids → not_found, no service call', async () => {
    expect(await moveFunnelLeadAction(form({ leadId: 'l1' }))).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(moveFunnelLead).not.toHaveBeenCalled();
  });
  it('passes reason; maps service error', async () => {
    moveFunnelLead.mockResolvedValue({ ok: false, error: 'reason_required' });
    const res = await moveFunnelLeadAction(
      form({ leadId: 'l1', toStageId: 'default:rejected', reason: 'x' })
    );
    expect(res).toEqual({ ok: false, error: 'reason_required' });
    expect(moveFunnelLead).toHaveBeenCalledWith({}, SESSION, {
      leadId: 'l1',
      toStageId: 'default:rejected',
      reason: 'x',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('stage CRUD actions', () => {
  it('create builds input, returns id', async () => {
    createFunnelStage.mockResolvedValue({ ok: true, id: 's1' });
    const res = await createFunnelStageAction(
      form({ name: 'Оплата', position: '3', statusAnchor: 'qualified', isTerminal: 'on' })
    );
    expect(res).toEqual({ ok: true, id: 's1' });
    expect(createFunnelStage).toHaveBeenCalledWith(
      {},
      SESSION,
      expect.objectContaining({
        name: 'Оплата',
        position: 3,
        statusAnchor: 'qualified',
        isTerminal: true,
      })
    );
  });
  it('create maps position_taken', async () => {
    createFunnelStage.mockResolvedValue({ ok: false, error: 'position_taken' });
    expect(
      await createFunnelStageAction(form({ name: 'x', position: '1', statusAnchor: 'new' }))
    ).toEqual({ ok: false, error: 'position_taken' });
  });
  it('update requires id', async () => {
    expect(await updateFunnelStageAction(form({ name: 'x' }))).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(updateFunnelStage).not.toHaveBeenCalled();
  });
  it('update with id calls service', async () => {
    updateFunnelStage.mockResolvedValue({ ok: true });
    const res = await updateFunnelStageAction(
      form({ id: 's9', name: 'x', position: '2', statusAnchor: 'in_review' })
    );
    expect(res).toEqual({ ok: true });
    expect(updateFunnelStage).toHaveBeenCalledWith(
      {},
      SESSION,
      's9',
      expect.objectContaining({ position: 2 })
    );
  });
  it('delete requires id; with id calls service', async () => {
    expect(await deleteFunnelStageAction(new FormData())).toEqual({
      ok: false,
      error: 'validation',
    });
    deleteFunnelStage.mockResolvedValue({ ok: true });
    expect(await deleteFunnelStageAction(form({ id: 's3' }))).toEqual({ ok: true });
    expect(deleteFunnelStage).toHaveBeenCalledWith({}, SESSION, 's3');
  });
});
