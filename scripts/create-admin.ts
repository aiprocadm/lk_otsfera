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

import { PrismaClient, Role } from '@prisma/client';
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
    // Повторный запуск с тем же email — идемпотентный no-op: пароль НЕ перезаписываем.
    if (existing.role === Role.admin) {
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
        role: Role.admin,
        passwordHash,
        companyId: company.id,
        isActive: true,
      },
    });

    await recordAudit(tx, {
      userId: created.id,
      action: 'admin_bootstrapped',
      entity: 'user',
      entityId: created.id,
      after: { email, role: 'admin', companyId: company.id },
    });

    return created;
  });

  return { ok: true, created: true, userId: user.id };
}

// --- Runner: выполняется только при прямом запуске (tsx scripts/create-admin.ts),
// --- но НЕ при импорте ядра из тестов. ---

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || 'Администратор';
  const company = process.env.ADMIN_COMPANY?.trim() || 'Промтехносфера';

  if (!email || !password) {
    console.error('✗ Заданы не все обязательные env: ADMIN_EMAIL и ADMIN_PASSWORD.');
    console.error(
      '  Пример: ADMIN_EMAIL=admin@example.ru ADMIN_PASSWORD=secret12 npm run db:create-admin'
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  let code = 0;
  try {
    const result = await bootstrapAdmin(prisma, { email, password, name, company });
    if (!result.ok) {
      const msg: Record<'invalid_email' | 'weak_password' | 'email_taken_non_admin', string> = {
        invalid_email: 'некорректный ADMIN_EMAIL',
        weak_password: `ADMIN_PASSWORD короче ${MIN_PASSWORD_LENGTH} символов`,
        email_taken_non_admin:
          'email уже занят пользователем с другой ролью — повышение до admin запрещено',
      };
      console.error(`✗ ${msg[result.error]}`);
      code = 1;
    } else if (result.created) {
      console.log(`✓ admin создан: ${email}`);
    } else {
      console.log(`• admin уже существует: ${email} (ничего не изменено)`);
    }
  } catch (err) {
    console.error('✗ Ошибка БД при создании админа:', err);
    code = 1;
  } finally {
    await prisma.$disconnect();
  }
  process.exit(code);
}

const invoked = (process.argv[1] ?? '').replace(/\\/g, '/');
if (invoked.endsWith('scripts/create-admin.ts')) {
  void main();
}
