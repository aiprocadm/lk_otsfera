// scripts/create-admin.ts
//
// Bootstrap первого реального администратора в не-демо БД.
//
// В чистой БД войти невозможно: createUser (admin/users) требует existing admin
// и отказывается создавать роль admin; 1С-синхронизация юзеров не создаёт;
// единственный сегодняшний источник admin — seed.ts (демо). Этот скрипт даёт
// оператору разовый идемпотентный способ завести первого боевого админа.
//
// Запуск (вход только через env — пароль не должен попадать в историю shell / ps):
//   ADMIN_EMAIL=admin@example.ru ADMIN_PASSWORD=secret12 npm run db:create-admin
// Необязательные: ADMIN_NAME (деф. «Администратор»), ADMIN_COMPANY (деф. «Промтехносфера»).
//
// Коды выхода: 0 — создан или уже был admin; 1 — ошибка валидации / email занят
// не-admin / сбой БД.

import { PrismaClient, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { recordAudit } from '../src/lib/auth/audit';

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type BootstrapAdminArgs = {
  email: string;
  password: string;
  name: string;
  company: string;
};

export type BootstrapAdminResult =
  | { ok: true; created: boolean; userId: string }
  | { ok: false; error: 'invalid_email' | 'weak_password' | 'email_taken_non_admin' };

export async function bootstrapAdmin(
  prisma: PrismaClient,
  args: BootstrapAdminArgs
): Promise<BootstrapAdminResult> {
  const email = args.email.trim();
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'invalid_email' };
  if (args.password.length < MIN_PASSWORD_LENGTH) return { ok: false, error: 'weak_password' };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role === ('admin' as Role)) {
      return { ok: true, created: false, userId: existing.id };
    }
    return { ok: false, error: 'email_taken_non_admin' };
  }

  const passwordHash = await bcrypt.hash(args.password, 10);

  const user = await prisma.$transaction(async (tx) => {
    const existingCompany = await tx.company.findFirst({ where: { name: args.company } });
    const company = existingCompany ?? (await tx.company.create({ data: { name: args.company } }));

    const created = await tx.user.create({
      data: {
        email,
        name: args.name,
        role: 'admin' as Role,
        passwordHash,
        companyId: company.id,
        isActive: true
      }
    });

    await recordAudit(tx, {
      userId: created.id,
      action: 'admin_bootstrapped',
      entity: 'user',
      entityId: created.id,
      after: { email, role: 'admin', companyId: company.id }
    });

    return created;
  });

  return { ok: true, created: true, userId: user.id };
}
