import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { bootstrapAdmin } from '../../scripts/create-admin';

const prisma = new PrismaClient();

const EMAIL = 'bootstrap-admin@test.local';
const EMAIL_TAKEN = 'bootstrap-taken@test.local';
const COMPANY = 'Bootstrap Test Co (fixture)';
const PASSWORD = 'BootstrapPw123';

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { in: [EMAIL, EMAIL_TAKEN] } },
    select: { id: true }
  });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.company.deleteMany({ where: { name: COMPANY } });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('bootstrapAdmin', () => {
  it('создаёт admin в пустой БД (happy path)', async () => {
    const res = await bootstrapAdmin(prisma, {
      email: EMAIL,
      password: PASSWORD,
      name: 'Администратор',
      company: COMPANY
    });
    expect(res).toEqual({ ok: true, created: true, userId: expect.any(String) });

    const user = await prisma.user.findUnique({ where: { email: EMAIL } });
    expect(user?.role).toBe('admin');
    expect(user?.isActive).toBe(true);
    expect(user?.companyId).toBeTruthy();
    expect(await bcrypt.compare(PASSWORD, user!.passwordHash!)).toBe(true);

    const company = await prisma.company.findFirst({ where: { name: COMPANY } });
    expect(user?.companyId).toBe(company?.id);

    const audit = await prisma.auditLog.findMany({ where: { userId: user!.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('admin_bootstrapped');
  });

  it('идемпотентен: повтор не создаёт второго и не пишет второй audit', async () => {
    const first = await bootstrapAdmin(prisma, { email: EMAIL, password: PASSWORD, name: 'A', company: COMPANY });
    expect(first.ok && first.created).toBe(true);

    const second = await bootstrapAdmin(prisma, { email: EMAIL, password: PASSWORD, name: 'A', company: COMPANY });
    expect(second).toEqual({ ok: true, created: false, userId: expect.any(String) });

    const users = await prisma.user.findMany({ where: { email: EMAIL } });
    expect(users).toHaveLength(1);
    const audit = await prisma.auditLog.findMany({ where: { userId: users[0].id } });
    expect(audit).toHaveLength(1);
  });

  it('переиспользует существующую компанию по имени', async () => {
    await prisma.company.create({ data: { name: COMPANY } });
    await bootstrapAdmin(prisma, { email: EMAIL, password: PASSWORD, name: 'A', company: COMPANY });
    const companies = await prisma.company.findMany({ where: { name: COMPANY } });
    expect(companies).toHaveLength(1);
  });

  it('отказывает, если email занят НЕ-admin учёткой', async () => {
    await prisma.user.create({
      data: { email: EMAIL_TAKEN, name: 'Менеджер', role: 'manager', isActive: true }
    });
    const res = await bootstrapAdmin(prisma, { email: EMAIL_TAKEN, password: PASSWORD, name: 'A', company: COMPANY });
    expect(res).toEqual({ ok: false, error: 'email_taken_non_admin' });

    const user = await prisma.user.findUnique({ where: { email: EMAIL_TAKEN } });
    expect(user?.role).toBe('manager');
  });

  it('отклоняет слабый пароль и ничего не создаёт', async () => {
    const res = await bootstrapAdmin(prisma, { email: EMAIL, password: 'short', name: 'A', company: COMPANY });
    expect(res).toEqual({ ok: false, error: 'weak_password' });
    expect(await prisma.user.findUnique({ where: { email: EMAIL } })).toBeNull();
  });

  it('отклоняет некорректный email и ничего не создаёт', async () => {
    const res = await bootstrapAdmin(prisma, { email: 'not-an-email', password: PASSWORD, name: 'A', company: COMPANY });
    expect(res).toEqual({ ok: false, error: 'invalid_email' });
  });
});
