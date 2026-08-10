import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Страж миграции-«замка» (`У-34а`, этап 6 PR-3) на живом Postgres.
 *
 * Требование ТЗ: если неразобранные заявки остались, миграция обязана упасть
 * **своим текстом** — что делать и сколько строк мешает, — а не сообщением
 * PostgreSQL про нарушение ограничения, по которому непонятно ничего.
 *
 * Текст стража берётся ИЗ САМОЙ МИГРАЦИИ, а не переписывается сюда: иначе
 * тест проверял бы свою копию и молча разъехался бы с тем, что реально
 * накатывается.
 */
const prisma = new PrismaClient();
const T = 'mig-lock-int';

const MIGRATION = path.join(
  process.cwd(),
  'prisma/migrations/20260810180000_stage6_item_direction_required/migration.sql'
);

/** Блок `DO $$ … END $$;` из файла миграции — это и есть страж. */
function guardSql(): string {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf('DO $$');
  const end = sql.indexOf('END $$;', start);
  if (start < 0 || end < 0) throw new Error('в миграции не найден блок стража DO $$ … END $$;');
  return sql.slice(start, end + 'END $$;'.length);
}

let requestId = '';
let itemId = '';

beforeAll(async () => {
  const user = await prisma.user.upsert({
    where: { id: `${T}-user` },
    update: {},
    create: { id: `${T}-user`, email: `${T}@mig.test`, name: 'Мигратор', role: 'organization' },
  });
  const org = await prisma.organization.create({ data: { name: `${T}-Организация` } });
  const dir = await prisma.trainingDirection.create({
    data: { name: `${T}-Направление`, sortOrder: 950 },
  });
  const request = await prisma.enrollmentRequest.create({
    data: {
      submittedByUserId: user.id,
      submitterRole: 'organization',
      organizationId: org.id,
      directionId: dir.id,
    },
  });
  requestId = request.id;
  const item = await prisma.enrollmentRequestItem.create({
    data: {
      requestId: request.id,
      directionId: dir.id,
      fullName: 'Иван Мигратов',
      email: `${T}-ivan@mig.test`,
    },
  });
  itemId = item.id;
});

afterAll(async () => {
  await prisma.enrollmentRequest.deleteMany({ where: { id: requestId } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: T } } });
  await prisma.trainingDirection.deleteMany({ where: { name: { startsWith: T } } });
  await prisma.user.deleteMany({ where: { id: `${T}-user` } });
  await prisma.$disconnect();
});

describe('У-34а: страж миграции «направление обязательно»', () => {
  it('замок уже накатан: колонка directionId — NOT NULL', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ is_nullable: string }>>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'EnrollmentRequestItem' AND column_name = 'directionId'`
    );
    expect(rows[0]?.is_nullable).toBe('NO');
  });

  it('на чистых данных страж молчит и пропускает миграцию дальше', async () => {
    await expect(prisma.$executeRawUnsafe(guardSql())).resolves.toBeDefined();
  });

  it('при неразобранных заявках падает СВОИМ текстом с числом строк и что делать', async () => {
    // Возвращаем колонку в состояние «до замка» внутри транзакции и портим
    // одну строку — транзакция откатится вместе с исключением стража, база
    // останется нетронутой (DDL в PostgreSQL транзакционный).
    const attempt = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `ALTER TABLE "EnrollmentRequestItem" ALTER COLUMN "directionId" DROP NOT NULL`
      );
      await tx.$executeRawUnsafe(
        `UPDATE "EnrollmentRequestItem" SET "directionId" = NULL WHERE id = $1`,
        itemId
      );
      await tx.$executeRawUnsafe(guardSql());
    });

    await expect(attempt).rejects.toThrow(/Нельзя сделать направление обязательным/);
    await expect(attempt.catch((e: Error) => e.message)).resolves.toMatch(
      /report:legacy-enrollments|\/admin\/enrollments\/legacy/
    );

    // Откат состоялся: колонка снова NOT NULL, строка цела.
    const rows = await prisma.$queryRawUnsafe<Array<{ is_nullable: string }>>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'EnrollmentRequestItem' AND column_name = 'directionId'`
    );
    expect(rows[0]?.is_nullable).toBe('NO');
    const item = await prisma.enrollmentRequestItem.findUnique({ where: { id: itemId } });
    expect(item?.directionId).toBeTruthy();
  });
});
