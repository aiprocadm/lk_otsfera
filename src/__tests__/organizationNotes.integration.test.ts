import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

// Доставку по каналам (почта, мессенджеры) в интеграционном тесте не гоняем —
// проверяем строку `Notification` в базе; `createNotification` остаётся настоящим.
vi.mock('@/lib/notifications/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications/core')>();
  return { ...actual, deliverNotificationToUser: vi.fn().mockResolvedValue({}) };
});

import {
  addOrganizationNote,
  editOrganizationNote,
  pinOrganizationNote,
  removeOrganizationNote,
} from '@/lib/services/organizationNotes/mutate';
import { canDeleteNote, canEditNote } from '@/lib/services/organizationNotes/policy';

/**
 * Внутренние заметки на живом Postgres (этап 1 ТЗ 12.09.2026, `У-183`, спека
 * §3.6): менеджер пишет заметку с @упоминанием — коллега получает уведомление
 * `note_mention` с `meta.entity = organization`; руководитель удаляет чужую,
 * менеджер — нет; закрепить можно три; партнёр и заказчик не видят даже
 * существования заметок.
 */
const prisma = new PrismaClient();
const STAMP = `note${Date.now()}`;

let companyId: string;
let orgId: string;
let managerId: string;
let leaderId: string;
let colleagueId: string;

const session = (sub: string, role: string): SessionPayload =>
  ({ sub, role, companyId, managedOrgIds: [orgId] }) as unknown as SessionPayload;

beforeAll(async () => {
  const co = await prisma.company.create({
    data: { name: `${STAMP}-co`, managerTeamVisibility: true },
  });
  companyId = co.id;
  const org = await prisma.organization.create({ data: { name: `${STAMP}-org`, companyId } });
  orgId = org.id;
  const [mgr, lead, col] = await Promise.all([
    prisma.user.create({
      data: { email: `${STAMP}-m@t.test`, name: `${STAMP}-Менеджер`, role: 'manager', companyId },
    }),
    prisma.user.create({
      data: {
        email: `${STAMP}-l@t.test`,
        name: `${STAMP}-Руководитель`,
        role: 'leader',
        companyId,
      },
    }),
    prisma.user.create({
      data: { email: `${STAMP}-c@t.test`, name: `Коллега${STAMP}`, role: 'manager', companyId },
    }),
  ]);
  managerId = mgr.id;
  leaderId = lead.id;
  colleagueId = col.id;
});

afterAll(async () => {
  const users = [managerId, leaderId, colleagueId];
  await prisma.notification.deleteMany({ where: { userId: { in: users } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: users } } });
  await prisma.organizationNote.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.organization.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('заметки организации (У-183)', () => {
  let noteId: string;

  it('менеджер пишет заметку с упоминанием — коллега получает note_mention, автор — нет', async () => {
    const res = await addOrganizationNote(prisma, session(managerId, 'manager'), {
      organizationId: orgId,
      body: `Обсудить с @Коллега${STAMP} скидку`,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    noteId = res.noteId;

    const note = await prisma.organizationNote.findUniqueOrThrow({ where: { id: noteId } });
    expect(note.mentionUserIds).toEqual([colleagueId]);
    expect(note.companyId).toBe(companyId);

    const notifications = await prisma.notification.findMany({
      where: { type: 'note_mention', userId: colleagueId },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.meta).toEqual({
      entity: 'organization',
      organizationId: orgId,
      noteId,
    });
    expect(
      await prisma.notification.count({ where: { type: 'note_mention', userId: managerId } })
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { action: 'organization_note_created', entityId: noteId },
      })
    ).toBe(1);
  });

  it('закрепление пишет pinnedAt и аудит; права правки/удаления считаются политикой', async () => {
    const pin = await pinOrganizationNote(prisma, session(managerId, 'manager'), {
      noteId,
      pinned: true,
    });
    expect(pin).toEqual({ ok: true, noteId });
    const note = await prisma.organizationNote.findUniqueOrThrow({ where: { id: noteId } });
    expect(note.pinnedAt).not.toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { action: 'organization_note_pinned', entityId: noteId },
      })
    ).toBe(1);
    expect(canEditNote(session(managerId, 'manager'), note)).toBe(true);
    expect(canDeleteNote(session(managerId, 'manager'))).toBe(false);
    expect(canEditNote(session(leaderId, 'leader'), note)).toBe(true);
    expect(canDeleteNote(session(leaderId, 'leader'))).toBe(true);
  });

  it('лимит закреплённых — три', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await addOrganizationNote(prisma, session(managerId, 'manager'), {
        organizationId: orgId,
        body: `ещё ${i}`,
      });
      if (r.ok) ids.push(r.noteId);
    }
    expect(
      await pinOrganizationNote(prisma, session(managerId, 'manager'), {
        noteId: ids[0]!,
        pinned: true,
      })
    ).toEqual({ ok: true, noteId: ids[0] });
    expect(
      await pinOrganizationNote(prisma, session(managerId, 'manager'), {
        noteId: ids[1]!,
        pinned: true,
      })
    ).toEqual({ ok: true, noteId: ids[1] });
    expect(
      await pinOrganizationNote(prisma, session(managerId, 'manager'), {
        noteId: ids[2]!,
        pinned: true,
      })
    ).toEqual({
      ok: false,
      error: 'note_pin_limit',
    });
  });

  it('правка: новых упомянутых оповещаем, уже оповещённых — нет', async () => {
    const before = await prisma.notification.count({
      where: { type: 'note_mention', userId: colleagueId },
    });
    const res = await editOrganizationNote(prisma, session(managerId, 'manager'), {
      noteId,
      body: `Обсудить с @Коллега${STAMP} и @${STAMP}-Руководитель скидку`,
    });
    expect(res).toEqual({ ok: true, noteId });
    expect(
      await prisma.notification.count({ where: { type: 'note_mention', userId: colleagueId } })
    ).toBe(before);
    expect(
      await prisma.notification.count({ where: { type: 'note_mention', userId: leaderId } })
    ).toBe(1);
  });

  it('партнёр и заказчик не видят заметок (not_found), менеджер не удаляет (forbidden), руководитель удаляет с аудитом', async () => {
    const partner = {
      sub: 'p1',
      role: 'partner',
      companyId,
      partnerId: 'x',
    } as unknown as SessionPayload;
    const customer = {
      sub: 'o1',
      role: 'organization',
      companyId,
      organizationId: orgId,
    } as unknown as SessionPayload;
    expect(
      await addOrganizationNote(prisma, partner, { organizationId: orgId, body: 'x' })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(
      await addOrganizationNote(prisma, customer, { organizationId: orgId, body: 'x' })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(await removeOrganizationNote(prisma, partner, { noteId })).toEqual({
      ok: false,
      error: 'not_found',
    });

    expect(await removeOrganizationNote(prisma, session(managerId, 'manager'), { noteId })).toEqual(
      {
        ok: false,
        error: 'forbidden',
      }
    );
    expect(await removeOrganizationNote(prisma, session(leaderId, 'leader'), { noteId })).toEqual({
      ok: true,
      noteId,
    });
    expect(await prisma.organizationNote.findUnique({ where: { id: noteId } })).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'organization_note_deleted', entityId: noteId },
    });
    expect((audit!.meta as { before: { body: string } }).before.body).toContain('скидку');
  });

  it('чужая компания → not_found', async () => {
    const other = await prisma.company.create({ data: { name: `${STAMP}-other` } });
    const stranger = await prisma.user.create({
      data: { email: `${STAMP}-s@t.test`, name: 'S', role: 'leader', companyId: other.id },
    });
    const s = {
      sub: stranger.id,
      role: 'leader',
      companyId: other.id,
    } as unknown as SessionPayload;
    expect(await addOrganizationNote(prisma, s, { organizationId: orgId, body: 'чужое' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    await prisma.user.delete({ where: { id: stranger.id } });
    await prisma.company.delete({ where: { id: other.id } });
  });
});
