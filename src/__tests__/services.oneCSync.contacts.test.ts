/**
 * `У-256` — контакты контрагента из 1С.
 *
 * Критерий приёмки один и он про повторный запуск: второй обмен не должен
 * создавать дублей. Всё остальное — про то, чтобы импорт не сделал хуже, чем
 * было: не затёр заполненное пустым и не приписал чужой телефон своему
 * контрагенту.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { writeSyncLog } = vi.hoisted(() => ({ writeSyncLog: vi.fn() }));
vi.mock('@/lib/services/oneCSync/log', () => ({ writeSyncLog }));

import { syncOrgContactsFromOneC } from '@/lib/services/oneCSync/contacts';

const ORG = 'org-1';
const COMPANY = 'co-1';

function db(owners: Array<{ contactId: string; organizationId: string | null }> = []) {
  const findMany = vi
    .fn()
    .mockResolvedValue(
      owners.map((o) => ({ contactId: o.contactId, contact: { organizationId: o.organizationId } }))
    );
  const create = vi.fn().mockResolvedValue({ id: 'new-contact' });
  const update = vi.fn().mockResolvedValue({});
  const upsert = vi.fn().mockResolvedValue({});
  return {
    prisma: {
      contactChannel: { findMany, upsert },
      contact: { create, update },
    } as unknown as PrismaClient,
    findMany,
    create,
    update,
    upsert,
  };
}

const args = (contacts: Parameters<typeof syncOrgContactsFromOneC>[1]['contacts']) => ({
  organizationId: ORG,
  companyId: COMPANY,
  externalId: '1c-org-001',
  contacts,
});

describe('syncOrgContactsFromOneC', () => {
  beforeEach(() => vi.clearAllMocks());

  it('новый человек заводится вместе с каналами', async () => {
    const { prisma, create } = db();
    const res = await syncOrgContactsFromOneC(
      prisma,
      args([
        {
          name: 'Иванова Мария',
          position: 'Бухгалтер',
          phone: '+7 (900) 123-45-67',
          email: 'buh@x.test',
        },
      ])
    );
    expect(res).toEqual({ created: 1, updated: 0, conflicts: 0 });

    const data = create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ organizationId: ORG, companyId: COMPANY, name: 'Иванова Мария' });
    const channels = data.channels.create as Array<{ type: string; value: string }>;
    expect(channels.map((c) => c.type).sort()).toEqual(['email', 'phone']);
  });

  it('повторный запуск не создаёт дубля — человек уже найден по каналу', async () => {
    const { prisma, create, update } = db([{ contactId: 'c-1', organizationId: ORG }]);
    const res = await syncOrgContactsFromOneC(
      prisma,
      args([{ name: 'Иванова Мария', phone: '89001234567' }])
    );
    expect(res).toEqual({ created: 0, updated: 1, conflicts: 0 });
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c-1' } }));
  });

  it('пустая должность из 1С не затирает заполненную', async () => {
    const { prisma, update } = db([{ contactId: 'c-1', organizationId: ORG }]);
    await syncOrgContactsFromOneC(
      prisma,
      args([{ name: 'Иванова Мария', position: '   ', phone: '89001234567' }])
    );
    expect(update.mock.calls[0]![0].data).toEqual({ name: 'Иванова Мария' });
  });

  it('непустая должность из 1С обновляет — как у реквизитов организации', async () => {
    const { prisma, update } = db([{ contactId: 'c-1', organizationId: ORG }]);
    await syncOrgContactsFromOneC(
      prisma,
      args([{ name: 'Иванова Мария', position: 'Главбух', phone: '89001234567' }])
    );
    expect(update.mock.calls[0]![0].data).toEqual({
      name: 'Иванова Мария',
      position: 'Главбух',
    });
  });

  it('канал чужой организации не пишется, а зовёт человека', async () => {
    const { prisma, create, update } = db([{ contactId: 'c-9', organizationId: 'org-ДРУГАЯ' }]);
    const res = await syncOrgContactsFromOneC(
      prisma,
      args([{ name: 'Иванова Мария', phone: '89001234567' }])
    );
    expect(res).toEqual({ created: 0, updated: 0, conflicts: 1 });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();

    const entry = writeSyncLog.mock.calls[0]![0];
    expect(entry).toMatchObject({ entity: 'contact', status: 'warn', operation: 'skip' });
    expect(entry.errorMessage).toContain('объедините контакты');
    expect(entry.payload).toMatchObject({ conflictingContactId: 'c-9' });
  });

  it('контакт без разбираемого телефона всё равно заводится', async () => {
    // Имя и должность полезны и без канала: «звонить через приёмную» — это не
    // повод потерять человека целиком.
    const { prisma, create } = db();
    const res = await syncOrgContactsFromOneC(
      prisma,
      args([{ name: 'Сидорова Анна', position: 'Секретарь', phone: 'через приёмную' }])
    );
    expect(res.created).toBe(1);
    expect(create.mock.calls[0]![0].data.channels.create).toEqual([]);
  });

  it('строка без имени пропускается молча — заводить некого', async () => {
    const { prisma, create } = db();
    const res = await syncOrgContactsFromOneC(
      prisma,
      args([{ name: '   ', phone: '89001234567' }])
    );
    expect(res).toEqual({ created: 0, updated: 0, conflicts: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  it('контактов нет — в базу за владельцами каналов не ходим', async () => {
    const { prisma, findMany } = db();
    const res = await syncOrgContactsFromOneC(prisma, args([]));
    expect(res).toEqual({ created: 0, updated: 0, conflicts: 0 });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('сбой записи одного канала не роняет перенос остальных', async () => {
    const { prisma, upsert } = db([{ contactId: 'c-1', organizationId: ORG }]);
    (upsert as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('гонка'));
    const res = await syncOrgContactsFromOneC(
      prisma,
      args([{ name: 'Иванова Мария', phone: '89001234567', email: 'buh@x.test' }])
    );
    expect(res.updated).toBe(1);
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});
