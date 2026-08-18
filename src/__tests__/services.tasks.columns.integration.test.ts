import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  listTaskColumns,
  createTaskColumn,
  updateTaskColumn,
  deleteTaskColumn,
} from '@/lib/services/tasks/columns';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * G3.5 — CRUD колонок канбана задач против Postgres. Роль-гейт admin|leader,
 * company-scoped IDOR (→ not_found), position_taken на @@unique([companyId,position]).
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyA: string, companyB: string;
let leaderA: string, plainA: string, leaderB: string;

const leaderASession = (): SessionPayload =>
  ({
    sub: leaderA,
    role: 'leader',
    companyId: companyA,
  }) as unknown as SessionPayload;
const plainASession = (): SessionPayload =>
  ({
    sub: plainA,
    role: 'manager',
    companyId: companyA,
  }) as unknown as SessionPayload;
const leaderBSession = (): SessionPayload =>
  ({
    sub: leaderB,
    role: 'leader',
    companyId: companyB,
  }) as unknown as SessionPayload;

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `g35a-${STAMP}` } })).id;
  companyB = (await prisma.company.create({ data: { name: `g35b-${STAMP}` } })).id;
  leaderA = (
    await prisma.user.create({
      data: {
        email: `g35la-${STAMP}@t.local`,
        name: 'LA',
        role: 'leader',
        companyId: companyA,
      },
    })
  ).id;
  plainA = (
    await prisma.user.create({
      data: { email: `g35pa-${STAMP}@t.local`, name: 'PA', role: 'manager', companyId: companyA },
    })
  ).id;
  leaderB = (
    await prisma.user.create({
      data: {
        email: `g35lb-${STAMP}@t.local`,
        name: 'LB',
        role: 'leader',
        companyId: companyB,
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: { in: [leaderA, plainA, leaderB] } } });
  await prisma.taskColumn.deleteMany({ where: { companyId: { in: [companyA, companyB] } } });
  await prisma.user.deleteMany({ where: { id: { in: [leaderA, plainA, leaderB] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('TaskColumn CRUD', () => {
  it('плоский менеджер (не leader) → forbidden', async () => {
    const r = await createTaskColumn(prisma, plainASession(), {
      name: 'Бэклог',
      position: 0,
      statusAnchor: 'todo',
    });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });

  it('leader создаёт колонку и видит её в списке', async () => {
    const created = await createTaskColumn(prisma, leaderASession(), {
      name: 'Бэклог',
      position: 10,
      statusAnchor: 'todo',
      isDoneColumn: false,
    });
    expect(created.ok).toBe(true);
    const list = await listTaskColumns(prisma, leaderASession());
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.rows.some((c) => c.name === 'Бэклог' && c.position === 10)).toBe(true);
  });

  it('дубль позиции в компании → position_taken', async () => {
    await createTaskColumn(prisma, leaderASession(), {
      name: 'A',
      position: 11,
      statusAnchor: 'todo',
    });
    const dup = await createTaskColumn(prisma, leaderASession(), {
      name: 'B',
      position: 11,
      statusAnchor: 'in_progress',
    });
    expect(dup).toEqual({ ok: false, error: 'position_taken' });
  });

  it('пустое имя → validation', async () => {
    const r = await createTaskColumn(prisma, leaderASession(), {
      name: '  ',
      position: 12,
      statusAnchor: 'todo',
    });
    expect(r).toEqual({ ok: false, error: 'validation' });
  });

  it('color: не-hex строка → validation; валидный #RRGGBB → ok и сохраняется', async () => {
    expect(
      await createTaskColumn(prisma, leaderASession(), {
        name: 'Цвет',
        position: 15,
        statusAnchor: 'todo',
        color: '#ZZZZZZ',
      })
    ).toEqual({ ok: false, error: 'validation' });
    const ok = await createTaskColumn(prisma, leaderASession(), {
      name: 'Цвет',
      position: 15,
      statusAnchor: 'todo',
      color: '#22C55E',
    });
    expect(ok.ok).toBe(true);
    const list = await listTaskColumns(prisma, leaderASession());
    expect(list.ok && list.rows.find((c) => c.position === 15)?.color).toBe('#22C55E');
  });

  it('color: undefined/null → ok, сохраняется null', async () => {
    const noColor = await createTaskColumn(prisma, leaderASession(), {
      name: 'Без цвета',
      position: 16,
      statusAnchor: 'todo',
    });
    expect(noColor.ok).toBe(true);
    const nullColor = await createTaskColumn(prisma, leaderASession(), {
      name: 'Null-цвет',
      position: 17,
      statusAnchor: 'todo',
      color: null,
    });
    expect(nullColor.ok).toBe(true);
    const list = await listTaskColumns(prisma, leaderASession());
    if (!list.ok) throw new Error('list failed');
    expect(list.rows.find((c) => c.position === 16)?.color).toBeNull();
    expect(list.rows.find((c) => c.position === 17)?.color).toBeNull();
  });

  it('leader другой компании не может обновить чужую колонку → not_found (IDOR)', async () => {
    const created = await createTaskColumn(prisma, leaderASession(), {
      name: 'Секрет',
      position: 13,
      statusAnchor: 'review',
    });
    if (!created.ok) throw new Error('setup failed');
    const r = await updateTaskColumn(prisma, leaderBSession(), created.id, {
      name: 'Взлом',
      position: 13,
      statusAnchor: 'review',
    });
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('leader обновляет и удаляет свою колонку', async () => {
    const created = await createTaskColumn(prisma, leaderASession(), {
      name: 'Времянка',
      position: 14,
      statusAnchor: 'todo',
    });
    if (!created.ok) throw new Error('setup failed');
    expect(
      await updateTaskColumn(prisma, leaderASession(), created.id, {
        name: 'Готово-кастом',
        position: 14,
        statusAnchor: 'done',
        isDoneColumn: true,
      })
    ).toEqual({ ok: true });
    expect(await deleteTaskColumn(prisma, leaderASession(), created.id)).toEqual({ ok: true });
  });
});
