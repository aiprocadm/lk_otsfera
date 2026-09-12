import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Правки данных миграции этапа 1 (ТЗ 12.09.2026, спека §2): правила доставки
 * `deal_note_mention` переезжают на `note_mention`, а право `crm.contacts`
 * дописывается всем профилям, у которых его нет (умолчание `В-1-2`).
 * Миграция на тестовой базе уже применена, поэтому проверяем сами
 * SQL-выражения: берём их из файла миграции по маркерам `-- data:` и гоняем
 * против свежих фикстур — так тест ловит правку выражения, а не переписывает
 * его у себя.
 */
const prisma = new PrismaClient();
const STAMP = `mig${Date.now()}`;
const MIGRATION = path.join(
  process.cwd(),
  'prisma/migrations/20260913090000_stage1_contacts_notes/migration.sql'
);

function dataStatement(marker: string): string {
  const lines = readFileSync(MIGRATION, 'utf8').split('\n');
  const at = lines.findIndex((l) => l.trim() === `-- data:${marker}`);
  expect(at, `маркер -- data:${marker} пропал из миграции`).toBeGreaterThan(-1);
  const stmt = lines.slice(at + 1).find((l) => l.trim() && !l.trim().startsWith('--'));
  expect(stmt, `после маркера ${marker} нет выражения`).toBeTruthy();
  return stmt!;
}

let companyId: string;

beforeAll(async () => {
  const co = await prisma.company.create({ data: { name: `${STAMP}-co` } });
  companyId = co.id;
});

afterAll(async () => {
  await prisma.notificationRule.deleteMany({ where: { companyId } });
  await prisma.accessProfile.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('миграция stage1_contacts_notes — правки данных', () => {
  it('правило deal_note_mention переезжает на note_mention с сохранением роли, канала и значения', async () => {
    await prisma.notificationRule.create({
      data: {
        companyId,
        eventType: 'deal_note_mention',
        audience: 'staff',
        channel: 'email',
        enabled: false,
      },
    });
    await prisma.$executeRawUnsafe(dataStatement('note_mention'));
    const rules = await prisma.notificationRule.findMany({ where: { companyId } });
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      eventType: 'note_mention',
      audience: 'staff',
      channel: 'email',
      enabled: false,
    });
  });

  it('crm.contacts дописывается только тем профилям, у кого его нет, и ровно один раз', async () => {
    const legacy = await prisma.accessProfile.create({
      data: { companyId, name: `${STAMP}-legacy`, capabilities: ['export'] },
    });
    const fresh = await prisma.accessProfile.create({
      data: { companyId, name: `${STAMP}-fresh`, capabilities: ['crm.contacts', 'export'] },
    });
    await prisma.$executeRawUnsafe(dataStatement('crm.contacts'));
    // Идемпотентность: повторный прогон ничего не дублирует.
    await prisma.$executeRawUnsafe(dataStatement('crm.contacts'));
    const rows = await prisma.accessProfile.findMany({
      where: { id: { in: [legacy.id, fresh.id] } },
    });
    for (const row of rows) {
      expect(row.capabilities.filter((c) => c === 'crm.contacts')).toHaveLength(1);
      expect(row.capabilities).toContain('export');
    }
  });
});
