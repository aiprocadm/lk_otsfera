import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireSession,
  revalidatePath,
  moveDeal,
  createDeal,
  updateDeal,
  listDealStages,
  createDealStage,
  updateDealStage,
  deleteDealStage
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  moveDeal: vi.fn(),
  createDeal: vi.fn(),
  updateDeal: vi.fn(),
  listDealStages: vi.fn(),
  createDealStage: vi.fn(),
  updateDealStage: vi.fn(),
  deleteDealStage: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/deals/board', () => ({ moveDeal }));
vi.mock('@/lib/services/deals/crud', () => ({ createDeal, updateDeal }));
vi.mock('@/lib/services/access/dealStages', () => ({
  listDealStages,
  createDealStage,
  updateDealStage,
  deleteDealStage
}));

import {
  moveDealAction,
  createDealAction,
  updateDealAction,
  listDealStagesAction,
  createDealStageAction,
  updateDealStageAction,
  deleteDealStageAction
} from '@/server-actions/deals';

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

function expectBothPagesRevalidated(): void {
  expect(revalidatePath).toHaveBeenCalledWith('/manager/deals');
  expect(revalidatePath).toHaveBeenCalledWith('/leader/deals');
}

describe('moveDealAction', () => {
  it('forwards dealId/toStageId to the service and revalidates both deal pages on success', async () => {
    moveDeal.mockResolvedValue({ ok: true });
    const res = await moveDealAction(form({ dealId: 'd1', toStageId: 'st-1' }));
    expect(res).toEqual({ ok: true });
    expect(moveDeal).toHaveBeenCalledWith({}, SESSION, { dealId: 'd1', toStageId: 'st-1', lostReason: undefined });
    expectBothPagesRevalidated();
  });

  it('missing ids → not_found without calling the service', async () => {
    expect(await moveDealAction(form({ dealId: 'd1' }))).toEqual({ ok: false, error: 'not_found' });
    expect(await moveDealAction(form({ toStageId: 'st-1' }))).toEqual({ ok: false, error: 'not_found' });
    expect(moveDeal).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('forwards lostReason and passes through the service error code without revalidating', async () => {
    moveDeal.mockResolvedValue({ ok: false, error: 'lifecycle_violation' });
    const res = await moveDealAction(form({ dealId: 'd1', toStageId: 'st-lost', lostReason: 'Дорого' }));
    expect(res).toEqual({ ok: false, error: 'lifecycle_violation' });
    expect(moveDeal).toHaveBeenCalledWith({}, SESSION, { dealId: 'd1', toStageId: 'st-lost', lostReason: 'Дорого' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('createDealAction', () => {
  it('builds a DealInput from the form and returns the created deal id, revalidating both pages', async () => {
    createDeal.mockResolvedValue({ ok: true, deal: { id: 'd-new' } });
    const res = await createDealAction(
      form({ title: 'Сделка', amount: '100.50', organizationId: 'org-1', managerId: 'm-1', expectedCloseAt: '2026-09-01' })
    );
    expect(res).toEqual({ ok: true, id: 'd-new' });
    expect(createDeal).toHaveBeenCalledWith({}, SESSION, {
      title: 'Сделка',
      amount: '100.50',
      organizationId: 'org-1',
      managerId: 'm-1',
      expectedCloseAt: '2026-09-01'
    });
    expectBothPagesRevalidated();
  });

  it('empty optional fields become null in the DealInput', async () => {
    createDeal.mockResolvedValue({ ok: true, deal: { id: 'd-new' } });
    await createDealAction(form({ title: 'Только название' }));
    expect(createDeal).toHaveBeenCalledWith({}, SESSION, {
      title: 'Только название',
      amount: null,
      organizationId: null,
      managerId: null,
      expectedCloseAt: null
    });
  });

  it('passes through the validation error code and messages without revalidating', async () => {
    createDeal.mockResolvedValue({ ok: false, error: 'validation', messages: ['Укажите название сделки'] });
    const res = await createDealAction(form({ title: '' }));
    expect(res).toEqual({ ok: false, error: 'validation', messages: ['Укажите название сделки'] });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('updateDealAction', () => {
  it('missing id → not_found without calling the service', async () => {
    expect(await updateDealAction(form({ title: 'x' }))).toEqual({ ok: false, error: 'not_found' });
    expect(updateDeal).not.toHaveBeenCalled();
  });

  it('forwards dealId plus the DealInput to the service and revalidates on success', async () => {
    updateDeal.mockResolvedValue({ ok: true });
    const res = await updateDealAction(form({ id: 'd7', title: 'Новое имя', amount: '5' }));
    expect(res).toEqual({ ok: true });
    expect(updateDeal).toHaveBeenCalledWith({}, SESSION, {
      dealId: 'd7',
      title: 'Новое имя',
      amount: '5',
      organizationId: null,
      managerId: null,
      expectedCloseAt: null
    });
    expectBothPagesRevalidated();
  });

  it('passes through the service error code without revalidating', async () => {
    updateDeal.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(await updateDealAction(form({ id: 'd7', title: 'x' }))).toEqual({ ok: false, error: 'forbidden' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('listDealStagesAction', () => {
  it('returns the service result as-is (rows)', async () => {
    const rows = [{ id: 's1', name: 'Новая' }];
    listDealStages.mockResolvedValue({ ok: true, rows });
    expect(await listDealStagesAction()).toEqual({ ok: true, rows });
    expect(listDealStages).toHaveBeenCalledWith({}, SESSION);
  });

  it('returns the service error as-is', async () => {
    listDealStages.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(await listDealStagesAction()).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('createDealStageAction', () => {
  it('builds the stage input (position number, isTerminal checkbox) and returns the id', async () => {
    createDealStage.mockResolvedValue({ ok: true, id: 's-new' });
    const res = await createDealStageAction(
      form({ name: 'Оплата', position: '3', statusAnchor: 'won', color: '#22C55E', isTerminal: 'on' })
    );
    expect(res).toEqual({ ok: true, id: 's-new' });
    expect(createDealStage).toHaveBeenCalledWith({}, SESSION, {
      name: 'Оплата',
      position: 3,
      statusAnchor: 'won',
      color: '#22C55E',
      isTerminal: true
    });
    expectBothPagesRevalidated();
  });

  it('defaults: position 0, anchor open, color null, isTerminal false', async () => {
    createDealStage.mockResolvedValue({ ok: true, id: 's-new' });
    await createDealStageAction(form({ name: 'Пустая' }));
    expect(createDealStage).toHaveBeenCalledWith({}, SESSION, {
      name: 'Пустая',
      position: 0,
      statusAnchor: 'open',
      color: null,
      isTerminal: false
    });
  });

  it('passes through position_taken without revalidating', async () => {
    createDealStage.mockResolvedValue({ ok: false, error: 'position_taken' });
    expect(await createDealStageAction(form({ name: 'x', position: '1' }))).toEqual({
      ok: false,
      error: 'position_taken'
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('updateDealStageAction', () => {
  it('missing id → validation without calling the service', async () => {
    expect(await updateDealStageAction(form({ name: 'x' }))).toEqual({ ok: false, error: 'validation' });
    expect(updateDealStage).not.toHaveBeenCalled();
  });

  it('forwards id and the stage input, revalidates on success', async () => {
    updateDealStage.mockResolvedValue({ ok: true });
    const res = await updateDealStageAction(form({ id: 's9', name: 'x', position: '2', statusAnchor: 'lost' }));
    expect(res).toEqual({ ok: true });
    expect(updateDealStage).toHaveBeenCalledWith({}, SESSION, 's9', expect.objectContaining({ position: 2, statusAnchor: 'lost' }));
    expectBothPagesRevalidated();
  });

  it('passes through the service error without revalidating', async () => {
    updateDealStage.mockResolvedValue({ ok: false, error: 'not_found' });
    expect(await updateDealStageAction(form({ id: 's9', name: 'x' }))).toEqual({ ok: false, error: 'not_found' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('deleteDealStageAction', () => {
  it('missing id → validation without calling the service', async () => {
    expect(await deleteDealStageAction(new FormData())).toEqual({ ok: false, error: 'validation' });
    expect(deleteDealStage).not.toHaveBeenCalled();
  });

  it('forwards the id, revalidates on success; passes errors through', async () => {
    deleteDealStage.mockResolvedValue({ ok: true });
    expect(await deleteDealStageAction(form({ id: 's3' }))).toEqual({ ok: true });
    expect(deleteDealStage).toHaveBeenCalledWith({}, SESSION, 's3');
    expectBothPagesRevalidated();

    vi.clearAllMocks();
    requireSession.mockResolvedValue(SESSION);
    deleteDealStage.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(await deleteDealStageAction(form({ id: 's3' }))).toEqual({ ok: false, error: 'forbidden' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
