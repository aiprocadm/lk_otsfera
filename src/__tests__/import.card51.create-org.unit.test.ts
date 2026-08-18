/**
 * Этап 10 (Т-30): создание организации из строки очереди — юнит-слой на
 * мокнутой призме. Права, скоуп строки, валидации, компания по Т-41,
 * композиция resolveQueueRow, bind_failed, аудит. Живой Postgres —
 * в import.stage10-queue-create.integration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
const { resolveQueueRow } = vi.hoisted(() => ({ resolveQueueRow: vi.fn() }));
vi.mock('@/lib/services/import/oneCAccountCard/resolve-queue', () => ({ resolveQueueRow }));
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { error: logError, warn: vi.fn(), info: vi.fn() } }));

import { createOrgFromQueueRow } from '@/lib/services/import/oneCAccountCard/create-org';

const ADMIN = { sub: 'u-admin', role: 'admin' } as never;
const LEADER = {
  sub: 'u-leader',
  role: 'leader',
  companyId: 'co-1',
  managedOrgIds: [],
} as never;
const PLAIN_MANAGER = { sub: 'u-mgr', role: 'manager', managedOrgIds: [] } as never;

const VALID_INN = '7707083893'; // настоящая контрольная сумма

function makeDb(over: Record<string, unknown> = {}) {
  const db = {
    paymentImportRow: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 'row-1', status: 'needs_review', batch: { companyId: 'co-1' } }),
    },
    organization: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'org-new' }),
    },
    company: { findUnique: vi.fn().mockResolvedValue({ id: 'co-x' }) },
    ...over,
  };
  return db as never;
}

const baseArgs = { rowId: 'row-1', name: 'ООО Новая', inn: VALID_INN };

beforeEach(() => {
  recordAudit.mockClear().mockResolvedValue(undefined);
  resolveQueueRow.mockReset().mockResolvedValue({ ok: true, paymentId: 'pay-1' });
  logError.mockClear();
});

describe('права и скоуп строки', () => {
  it('клиентские роли к созданию организаций не допускаются вовсе', async () => {
    // Обычный менеджер не проходит дальше по скоупу (тест ниже), а вот
    // партнёр, заказчик и слушатель отсекаются самым первым гардом — эту
    // ветку не звал ни один тест.
    for (const role of ['partner', 'organization', 'student']) {
      const outsider = { sub: 'u-x', role } as never;
      expect(await createOrgFromQueueRow(makeDb(), outsider, baseArgs)).toEqual({
        ok: false,
        error: 'forbidden',
      });
    }
  });

  it('обычный менеджер → forbidden', async () => {
    expect(await createOrgFromQueueRow(makeDb(), PLAIN_MANAGER, baseArgs)).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('строки нет / уже обработана → not_found', async () => {
    const db = makeDb({ paymentImportRow: { findUnique: vi.fn().mockResolvedValue(null) } });
    expect(await createOrgFromQueueRow(db, ADMIN, baseArgs)).toEqual({
      ok: false,
      error: 'not_found',
    });
    const db2 = makeDb({
      paymentImportRow: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'row-1', status: 'resolved', batch: { companyId: 'co-1' } }),
      },
    });
    expect(await createOrgFromQueueRow(db2, ADMIN, baseArgs)).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('чужая компания для руководителя → not_found (существование не раскрываем)', async () => {
    const db = makeDb({
      paymentImportRow: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'row-1',
          status: 'needs_review',
          batch: { companyId: 'co-OTHER' },
        }),
      },
    });
    expect(await createOrgFromQueueRow(db, LEADER, baseArgs)).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('руководитель без companyId (скоуп orgs) → forbidden', async () => {
    const leaderNoCompany = {
      sub: 'l2',
      role: 'leader',
      companyId: null,
      managedOrgIds: [],
    } as never;
    expect(await createOrgFromQueueRow(makeDb(), leaderNoCompany, baseArgs)).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });
});

describe('валидации (Т-30)', () => {
  it('пустое наименование → name_required; кривой ИНН → bad_inn', async () => {
    expect(await createOrgFromQueueRow(makeDb(), ADMIN, { ...baseArgs, name: '  ' })).toEqual({
      ok: false,
      error: 'name_required',
    });
    expect(await createOrgFromQueueRow(makeDb(), ADMIN, { ...baseArgs, inn: '123' })).toEqual({
      ok: false,
      error: 'bad_inn',
    });
  });

  it('организация с таким ИНН уже есть → org_exists, ничего не создаём (§8.2 спеки)', async () => {
    const db = makeDb();
    (
      db as { organization: { findFirst: ReturnType<typeof vi.fn> } }
    ).organization.findFirst.mockResolvedValue({ id: 'org-old' });
    const res = await createOrgFromQueueRow(db, ADMIN, { ...baseArgs, companyId: 'co-x' });
    expect(res).toEqual({ ok: false, error: 'org_exists' });
    expect(
      (db as { organization: { create: ReturnType<typeof vi.fn> } }).organization.create
    ).not.toHaveBeenCalled();
  });

  it('admin без компании / с несуществующей компанией → company_required (Т-41)', async () => {
    expect(await createOrgFromQueueRow(makeDb(), ADMIN, baseArgs)).toEqual({
      ok: false,
      error: 'company_required',
    });
    const db = makeDb({ company: { findUnique: vi.fn().mockResolvedValue(null) } });
    expect(await createOrgFromQueueRow(db, ADMIN, { ...baseArgs, companyId: 'ghost' })).toEqual({
      ok: false,
      error: 'company_required',
    });
  });
});

describe('создание и привязка', () => {
  it('руководитель: компания из скоупа, параметр игнорируется; ИНН нормализуется; привязка через resolveQueueRow', async () => {
    const db = makeDb();
    const res = await createOrgFromQueueRow(db, LEADER, {
      rowId: 'row-1',
      name: '  ООО Новая  ',
      inn: ` ${VALID_INN} `,
      kpp: ' 770701001 ',
      companyId: 'co-foreign', // попытка подсунуть чужую — игнорируется
    });
    expect(res).toEqual({ ok: true, organizationId: 'org-new', paymentId: 'pay-1' });
    expect(
      (db as { organization: { create: ReturnType<typeof vi.fn> } }).organization.create
    ).toHaveBeenCalledWith({
      data: { name: 'ООО Новая', inn: VALID_INN, kpp: '770701001', companyId: 'co-1' },
      select: { id: true },
    });
    expect(resolveQueueRow).toHaveBeenCalledWith(db, LEADER, {
      rowId: 'row-1',
      organizationId: 'org-new',
      orderId: null,
    });
    expect(recordAudit).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        action: 'organization_created_manual',
        entityId: 'org-new',
        after: expect.objectContaining({ source: 'payment_queue', rowId: 'row-1' }),
      })
    );
  });

  it('admin: выбранная компания; пустой КПП → null', async () => {
    const db = makeDb();
    const res = await createOrgFromQueueRow(db, ADMIN, { ...baseArgs, companyId: 'co-x' });
    expect(res).toMatchObject({ ok: true });
    expect(
      (db as { organization: { create: ReturnType<typeof vi.fn> } }).organization.create
    ).toHaveBeenCalledWith({
      data: { name: 'ООО Новая', inn: VALID_INN, kpp: null, companyId: 'co-x' },
      select: { id: true },
    });
  });

  it('привязка упала → bind_failed с id организации (её НЕ откатываем, §8.3 спеки)', async () => {
    resolveQueueRow.mockResolvedValue({ ok: false, error: 'write_skipped' });
    const res = await createOrgFromQueueRow(makeDb(), LEADER, baseArgs);
    expect(res).toEqual({
      ok: false,
      error: 'bind_failed',
      organizationId: 'org-new',
      bindError: 'write_skipped',
    });
  });

  it('упавший аудит не роняет создание (non-blocking)', async () => {
    recordAudit.mockRejectedValue(new Error('audit down'));
    const res = await createOrgFromQueueRow(makeDb(), LEADER, baseArgs);
    expect(res).toMatchObject({ ok: true });
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('аудит создания организации'),
      expect.objectContaining({ message: 'audit down' })
    );
  });
});
