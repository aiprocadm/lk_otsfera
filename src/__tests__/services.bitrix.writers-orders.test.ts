import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApplyContext, Tx } from '@/lib/services/bitrix/writers/journal';
import type { OrderPlan } from '@/lib/services/bitrix/mapping/orders';
import { writeWonDealOrder } from '@/lib/services/bitrix/writers/orders';

/**
 * Заказ из выигранной сделки (`У-197`, спека §3.5).
 *
 * Проверяется то, ради чего модуль написан: живая связь «сделка ↔ заказ»
 * сильнее перенесённой (привязка идёт условием `orderId: null`, и занятую
 * сделку писатель не трогает), заказ-история заводится закрытым и без денег, а
 * запись «когда закрылся» появляется сразу — иначе заказ выглядел бы таким с
 * рождения. Транзакция — объект с нужными методами: живой Postgres здесь не
 * нужен и увёл бы файл в integration-слой.
 */
const dealCount = vi.fn(async () => 1);
const dealUpdateMany = vi.fn();
const orderCreate = vi.fn();
const orderStatusChangeCreate = vi.fn();
const journalCreate = vi.fn();

const tx = {
  deal: { updateMany: dealUpdateMany, count: dealCount },
  order: { create: orderCreate },
  orderStatusChange: { create: orderStatusChangeCreate },
  bitrixImportWrite: { create: journalCreate },
} as unknown as Tx;

const ctx: ApplyContext = {
  batchId: 'b1',
  companyId: 'c1',
  importerId: 'u-importer',
  defaultManagerId: 'm1',
  lastAfter: () => null,
};

const ARGS = { dealId: 'd1', bitrixDealId: '501' };

const CREATE_PLAN: OrderPlan = {
  action: 'create',
  data: {
    externalId: 'bitrix:deal:501',
    title: 'Сделка из Битрикс24',
    companyId: 'c1',
    organizationId: 'o1',
    managerId: 'm1',
    totalAmount: '150000',
    statusId: 'st-closed',
    executionStatus: 'completed',
    financialStatus: 'not_billed',
    closedAt: new Date('2026-01-01T10:00:00Z'),
    completedAt: new Date('2026-01-01T10:00:00Z'),
  },
};

const journalData = (): Record<string, unknown> => journalCreate.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  dealUpdateMany.mockResolvedValue({ count: 1 });
  orderCreate.mockResolvedValue({ id: 'ord-new' });
  orderStatusChangeCreate.mockResolvedValue({ id: 'osc-1' });
  journalCreate.mockResolvedValue({ id: 'w1' });
});

describe('writeWonDealOrder — привязка к заказу 1С', () => {
  it('проставляет сделке `orderId` только пока связь свободна и пишет журнал', async () => {
    const plan: OrderPlan = { action: 'link', orderId: 'ord-1c', orderLabel: 'ЗК-0001' };

    const out = await writeWonDealOrder(tx, ctx, plan, ARGS);

    expect(dealUpdateMany).toHaveBeenCalledWith({
      where: { id: 'd1', orderId: null },
      data: { orderId: 'ord-1c' },
    });
    expect(orderCreate).not.toHaveBeenCalled();
    expect(journalData()).toEqual({
      batchId: 'b1',
      entity: 'order',
      entityId: 'ord-1c',
      bitrixId: '501',
      action: 'linked',
      before: { dealId: 'd1', orderId: null },
      after: { dealId: 'd1', orderId: 'ord-1c' },
    });
    expect(out).toEqual({ entityId: 'ord-1c', action: 'linked', keptManual: [] });
  });

  it('сделка уже привязана — ничего не меняем и журнал не пишем', async () => {
    dealUpdateMany.mockResolvedValue({ count: 0 });

    const out = await writeWonDealOrder(
      tx,
      ctx,
      { action: 'link', orderId: 'ord-1c', orderLabel: 'ЗК-0001' },
      ARGS
    );

    expect(out).toBeNull();
    expect(journalCreate).not.toHaveBeenCalled();
  });
});

describe('writeWonDealOrder — заказ-история', () => {
  it('заводит закрытый заказ, историю статуса, связь со сделкой и журнал', async () => {
    const out = await writeWonDealOrder(tx, ctx, CREATE_PLAN, ARGS);

    expect(orderCreate).toHaveBeenCalledWith({
      data: {
        externalId: 'bitrix:deal:501',
        title: 'Сделка из Битрикс24',
        companyId: 'c1',
        organizationId: 'o1',
        managerId: 'm1',
        totalAmount: '150000',
        statusId: 'st-closed',
        executionStatus: 'completed',
        financialStatus: 'not_billed',
        closedAt: new Date('2026-01-01T10:00:00Z'),
        completedAt: new Date('2026-01-01T10:00:00Z'),
      },
      select: { id: true },
    });
    expect(orderStatusChangeCreate).toHaveBeenCalledWith({
      data: {
        orderId: 'ord-new',
        fromId: null,
        toId: 'st-closed',
        userId: null,
        reason: 'Перенесено из Битрикс24',
      },
    });
    expect(dealUpdateMany).toHaveBeenCalledWith({
      where: { id: 'd1', orderId: null },
      data: { orderId: 'ord-new' },
    });
    expect(journalData()).toEqual({
      batchId: 'b1',
      entity: 'order',
      entityId: 'ord-new',
      bitrixId: '501',
      action: 'created',
      after: {
        externalId: 'bitrix:deal:501',
        title: 'Сделка из Битрикс24',
        totalAmount: '150000',
        closedAt: '2026-01-01T10:00:00.000Z',
      },
    });
    expect(out).toEqual({ entityId: 'ord-new', action: 'created', keptManual: [] });
  });

  it('без статуса-якоря история статуса не пишется, а заказ всё равно заводится', async () => {
    const out = await writeWonDealOrder(
      tx,
      ctx,
      { action: 'create', data: { ...CREATE_PLAN.data, statusId: null } } as OrderPlan,
      ARGS
    );

    expect(orderStatusChangeCreate).not.toHaveBeenCalled();
    expect(orderCreate).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ entityId: 'ord-new', action: 'created', keptManual: [] });
  });

  it('сделка уже привязана к другому заказу — заказ-историю не заводим вовсе', async () => {
    // Связь «сделка ↔ заказ» одна. Заведи мы второй заказ, он повис бы ни на
    // чём, и ни сводка, ни журнал об этом не сказали бы.
    dealCount.mockResolvedValueOnce(0);

    const out = await writeWonDealOrder(tx, ctx, CREATE_PLAN, ARGS);

    expect(orderCreate).not.toHaveBeenCalled();
    expect(journalCreate).not.toHaveBeenCalled();
    expect(out).toBeNull();
  });
});

describe('writeWonDealOrder — планы без записи', () => {
  it.each([
    { action: 'skip', reason: 'no_organization' } as OrderPlan,
    { action: 'conflict', reason: 'no_manager' } as OrderPlan,
    { action: 'update', id: 'ord-1', data: {}, before: {} } as OrderPlan,
  ])('план `$action` ничего не пишет', async (plan) => {
    const out = await writeWonDealOrder(tx, ctx, plan, ARGS);

    expect(out).toBeNull();
    expect(orderCreate).not.toHaveBeenCalled();
    expect(dealUpdateMany).not.toHaveBeenCalled();
    expect(journalCreate).not.toHaveBeenCalled();
  });
});
