// src/__tests__/pii.record.unit.test.ts
/**
 * Unit tests for src/lib/pii/record.ts — never-throws запись журнала ПДн.
 * Флаг в тестовом env заглушён setup-файлом; здесь включаем явно.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recordPiiAccess, recordPiiAccessMany } from '@/lib/pii/record';
import type { SessionPayload } from '@/lib/auth/jwt';

const MANAGER: SessionPayload = { sub: 'u-mgr', role: 'manager', companyId: 'co-1' };
const LEADER: SessionPayload = {
  sub: 'u-led',
  role: 'leader',
  companyId: 'co-1',
};
const ADMIN: SessionPayload = { sub: 'u-adm', role: 'admin' };
const PARTNER: SessionPayload = { sub: 'u-par', role: 'partner' };

function makePrisma() {
  return {
    piiAccessEvent: {
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
  } as never;
}

beforeEach(() => {
  process.env.FEATURE_PII_ACCESS_LOG = '1';
});

afterEach(() => {
  process.env.FEATURE_PII_ACCESS_LOG = '0';
  vi.restoreAllMocks();
});

describe('recordPiiAccess', () => {
  it('пишет событие: контекст задаёт action/subjectType, роль и companyId снапшотятся', async () => {
    const p = makePrisma();
    await recordPiiAccess(p, {
      session: MANAGER,
      context: 'manager_students_list',
      subjectIds: ['s1', 's2'],
      meta: { take: 50, hasQuery: true },
    });
    expect((p as any).piiAccessEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'u-mgr',
        userRole: 'manager',
        companyId: 'co-1',
        context: 'manager_students_list',
        action: 'list',
        subjectType: 'student',
        subjectIds: ['s1', 's2'],
        subjectCount: 2,
        meta: { take: 50, hasQuery: true },
      },
    });
  });

  // ТЗ 2026-08-17: руководитель — самостоятельная роль. Прежняя пара кейсов
  // (суб-роль managerRole='leader' и top-level role='leader') описывала две
  // модели одновременно; после снятия колонки это один и тот же случай.
  it('роль leader: staff-гейт пускает, userRole снапшотится как leader', async () => {
    const p = makePrisma();
    await recordPiiAccess(p, { session: LEADER, context: 'enrollments_list', subjectIds: ['e1'] });
    expect((p as any).piiAccessEvent.create).toHaveBeenCalledTimes(1);
    expect((p as any).piiAccessEvent.create.mock.calls[0][0].data.userRole).toBe('leader');
  });

  it('admin без companyId → companyId: null; meta отсутствует, если не передана', async () => {
    const p = makePrisma();
    await recordPiiAccess(p, { session: ADMIN, context: 'admin_user_view', subjectIds: ['u9'] });
    const data = (p as any).piiAccessEvent.create.mock.calls[0][0].data;
    expect(data.companyId).toBeNull();
    expect(data).not.toHaveProperty('meta');
  });

  it('meta.cursor попадает в событие, когда передан', async () => {
    const p = makePrisma();
    await recordPiiAccess(p, {
      session: MANAGER,
      context: 'manager_students_list',
      subjectIds: ['s1'],
      meta: { cursor: true },
    });
    expect((p as any).piiAccessEvent.create.mock.calls[0][0].data.meta).toEqual({ cursor: true });
  });

  it('no-op: флаг выключен', async () => {
    process.env.FEATURE_PII_ACCESS_LOG = '0';
    const p = makePrisma();
    await recordPiiAccess(p, { session: MANAGER, context: 'calls_list', subjectIds: ['c1'] });
    expect((p as any).piiAccessEvent.create).not.toHaveBeenCalled();
  });

  it('no-op: не-staff сессия (partner)', async () => {
    const p = makePrisma();
    await recordPiiAccess(p, { session: PARTNER, context: 'enrollments_list', subjectIds: ['e1'] });
    expect((p as any).piiAccessEvent.create).not.toHaveBeenCalled();
  });

  it('no-op: пустая выдача', async () => {
    const p = makePrisma();
    await recordPiiAccess(p, { session: MANAGER, context: 'inbox_list', subjectIds: [] });
    expect((p as any).piiAccessEvent.create).not.toHaveBeenCalled();
  });

  it('fail-open: сбой insert проглатывается с log.error, данные не блокируются', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = makePrisma();
    (p as any).piiAccessEvent.create.mockRejectedValue(new Error('db down'));
    await expect(
      recordPiiAccess(p, { session: MANAGER, context: 'calls_list', subjectIds: ['c1'] })
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      'pii_access_log_write_failed',
      expect.objectContaining({ contexts: ['calls_list'], count: 1, error: 'db down' })
    );
  });

  it('fail-open: не-Error rejection стрингифицируется', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = makePrisma();
    (p as any).piiAccessEvent.create.mockRejectedValue('boom');
    await recordPiiAccess(p, { session: MANAGER, context: 'calls_list', subjectIds: ['c1'] });
    expect(errorSpy).toHaveBeenCalledWith(
      'pii_access_log_write_failed',
      expect.objectContaining({ error: 'boom' })
    );
  });
});

describe('recordPiiAccessMany', () => {
  it('несколько событий → один createMany', async () => {
    const p = makePrisma();
    await recordPiiAccessMany(p, [
      { session: MANAGER, context: 'org_card_inbound', subjectIds: ['m1', 'm2'] },
      { session: MANAGER, context: 'org_card_calls', subjectIds: ['c1'] },
    ]);
    expect((p as any).piiAccessEvent.createMany).toHaveBeenCalledTimes(1);
    const { data } = (p as any).piiAccessEvent.createMany.mock.calls[0][0];
    expect(data).toHaveLength(2);
    expect(data[0].subjectType).toBe('inbound_sender');
    expect(data[1].subjectType).toBe('caller');
  });

  it('пустые/не-staff элементы отфильтровываются; все пустые → no-op', async () => {
    const p = makePrisma();
    await recordPiiAccessMany(p, [
      { session: MANAGER, context: 'org_card_inbound', subjectIds: [] },
      { session: PARTNER, context: 'org_card_calls', subjectIds: ['c1'] },
    ]);
    expect((p as any).piiAccessEvent.create).not.toHaveBeenCalled();
    expect((p as any).piiAccessEvent.createMany).not.toHaveBeenCalled();
  });

  it('один выживший элемент → create, не createMany', async () => {
    const p = makePrisma();
    await recordPiiAccessMany(p, [
      { session: MANAGER, context: 'org_card_inbound', subjectIds: [] },
      { session: MANAGER, context: 'org_card_calls', subjectIds: ['c1'] },
    ]);
    expect((p as any).piiAccessEvent.create).toHaveBeenCalledTimes(1);
    expect((p as any).piiAccessEvent.createMany).not.toHaveBeenCalled();
  });
});
