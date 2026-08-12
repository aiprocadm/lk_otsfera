import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Автосоздание организаций при импорте выписки (`У-49`, `У-50`, `У-54`).
 *
 * Проверяем то, что отличает автосоздание от «просто create»: правило выбора
 * компании, след записи (без него откат оставил бы организации-сироты) и
 * источник в аудите, по которому карточка рисует плашку.
 */
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import {
  resolveNewOrgCompany,
  createOrganizationsForImport,
} from '@/lib/services/import/oneCAccountCard/auto-create';

const ADMIN = { sub: 'u-admin', role: 'admin', companyId: null } as never;
const LEADER = {
  sub: 'u-leader',
  role: 'manager',
  managerRole: 'leader',
  companyId: 'co-1',
  managedOrgIds: [],
} as never;
const PLAIN_MANAGER = {
  sub: 'u-mgr',
  role: 'manager',
  companyId: 'co-1',
  managedOrgIds: ['o1'],
} as never;

beforeEach(() => {
  recordAudit.mockClear();
});

describe('resolveNewOrgCompany (У-50)', () => {
  it('руководителю — своя компания, аргумент игнорируется', () => {
    expect(resolveNewOrgCompany(LEADER, 'co-OTHER')).toEqual({ ok: true, companyId: 'co-1' });
  });

  it('администратору — выбранная в форме; без выбора — company_required', () => {
    expect(resolveNewOrgCompany(ADMIN, 'co-7')).toEqual({ ok: true, companyId: 'co-7' });
    expect(resolveNewOrgCompany(ADMIN, '   ')).toEqual({ ok: false, error: 'company_required' });
    expect(resolveNewOrgCompany(ADMIN, undefined)).toEqual({
      ok: false,
      error: 'company_required',
    });
  });

  it('обычный менеджер организаций не заводит — not_allowed', () => {
    // Правило пришло вместе с допуском менеджера к импорту и здесь не смягчается.
    expect(resolveNewOrgCompany(PLAIN_MANAGER, 'co-1')).toEqual({
      ok: false,
      error: 'not_allowed',
    });
  });
});

describe('createOrganizationsForImport (У-49, У-54, след для У-59)', () => {
  function db() {
    const create = vi.fn().mockImplementation(async ({ data }: { data: { inn: string } }) => ({
      id: `org-${data.inn}`,
    }));
    const writeCreate = vi.fn();
    return {
      db: { organization: { create }, paymentImportWrite: { create: writeCreate } } as never,
      create,
      writeCreate,
    };
  }

  it('создаёт организацию, пишет след батча и аудит с источником', async () => {
    const { db: prisma, create, writeCreate } = db();
    const map = await createOrganizationsForImport(prisma, ADMIN, {
      candidates: [{ name: 'ООО «Альфа»', inn: '7707083893', rows: 2 }],
      companyId: 'co-7',
      batchId: 'b1',
      fileName: 'Карточка счета 51.xls',
    });

    expect(map.get('7707083893')).toBe('org-7707083893');
    expect(create.mock.calls[0]![0].data).toMatchObject({
      name: 'ООО «Альфа»',
      inn: '7707083893',
      companyId: 'co-7',
    });
    // `У-59`: без следа откат оставил бы организации-сироты.
    expect(writeCreate.mock.calls[0]![0].data).toMatchObject({
      batchId: 'b1',
      entity: 'organization',
      action: 'created',
      entityId: 'org-7707083893',
    });
    // `У-54`: источник, по которому карточка рисует плашку.
    expect(recordAudit.mock.calls[0]![1]).toMatchObject({
      action: 'organization_created_auto',
      entity: 'organization',
      after: { source: 'payment_import_auto', fileName: 'Карточка счета 51.xls' },
    });
  });

  it('контрагент без названия получает опознаваемое имя, а не пустую строку', async () => {
    const { db: prisma, create } = db();
    await createOrganizationsForImport(prisma, ADMIN, {
      candidates: [{ name: '', inn: '7736207543', rows: 1 }],
      companyId: 'co-7',
      batchId: 'b1',
      fileName: 'f.xls',
    });
    expect(create.mock.calls[0]![0].data.name).toBe('Организация по ИНН 7736207543');
  });

  it('упавший аудит не рвёт импорт — организация уже создана', async () => {
    // §3: побочные каналы деградируют мягко; плашки не будет, но данные целы.
    recordAudit.mockRejectedValueOnce(new Error('audit down'));
    const { db: prisma } = db();
    const map = await createOrganizationsForImport(prisma, ADMIN, {
      candidates: [{ name: 'ООО «Бета»', inn: '7707083893', rows: 1 }],
      companyId: 'co-7',
      batchId: 'b1',
      fileName: 'f.xls',
    });
    expect(map.size).toBe(1);
  });

  it('пустой список кандидатов не ходит в базу вовсе', async () => {
    const { db: prisma, create } = db();
    const map = await createOrganizationsForImport(prisma, ADMIN, {
      candidates: [],
      companyId: 'co-7',
      batchId: 'b1',
      fileName: 'f.xls',
    });
    expect(map.size).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });
});
