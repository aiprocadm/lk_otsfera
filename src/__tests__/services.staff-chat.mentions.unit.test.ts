import { it, expect, vi } from 'vitest';
import { extractMentions, listColleagues } from '@/lib/services/staffChat/mentions';
import { NO_COMPANY_SENTINEL } from '@/lib/services/staffChat/policy';

const staff = [
  { id: 'u1', name: 'Пётр Иванов' },
  { id: 'u2', name: 'Пётр' },
  { id: 'u3', name: 'Anna-Maria K.' },
];

it('longest-name-first: "@Пётр Иванов" матчит u1, не u2', () => {
  expect(extractMentions('привет @Пётр Иванов, глянь', staff)).toEqual(['u1']);
});

it('короткое имя матчится, регистронезависимо, дедуп', () => {
  expect(extractMentions('@пётр и ещё раз @Пётр', staff)).toEqual(['u2']);
});

it('ненайденные/пустые игнорируются; спецсимволы в имени экранируются', () => {
  expect(extractMentions('@Никто и @Anna-Maria K. тут', staff)).toEqual(['u3']);
  expect(extractMentions('без упоминаний', staff)).toEqual([]);
});

it('listColleagues: клиентская роль → пустой список без обращения к prisma', async () => {
  const findMany = vi.fn();
  const prisma = { user: { findMany } } as never;
  const res = await listColleagues(prisma, {
    role: 'partner',
    sub: 'p1',
    companyId: 'c1',
  } as never);
  expect(res).toEqual({ ok: true, rows: [] });
  expect(findMany).not.toHaveBeenCalled();
});

it('listColleagues: admin — без фильтра по компании (companyId: undefined)', async () => {
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma = { user: { findMany } } as never;
  await listColleagues(prisma, { role: 'admin', sub: 'a1', companyId: null } as never);
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { isActive: true, OR: [{ role: { in: ['manager', 'leader'] }, companyId: undefined }, { role: 'admin' }] },
    })
  );
});

it('listColleagues: manager со своей компанией — скоуп по companyId', async () => {
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma = { user: { findMany } } as never;
  await listColleagues(prisma, { role: 'manager', sub: 'm1', companyId: 'c1' } as never);
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { isActive: true, OR: [{ role: { in: ['manager', 'leader'] }, companyId: 'c1' }, { role: 'admin' }] },
    })
  );
});

it('listColleagues: manager без companyId — sentinel (deny-all), а не «без фильтра»', async () => {
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma = { user: { findMany } } as never;
  await listColleagues(prisma, { role: 'manager', sub: 'm1', companyId: null } as never);
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        isActive: true,
        OR: [{ role: { in: ['manager', 'leader'] }, companyId: NO_COMPANY_SENTINEL }, { role: 'admin' }],
      },
    })
  );
});
