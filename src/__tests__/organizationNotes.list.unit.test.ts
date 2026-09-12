import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { canManagerAccessOrg } = vi.hoisted(() => ({ canManagerAccessOrg: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ canManagerAccessOrg }));

import { listOrganizationNotes, toNoteView } from '@/lib/services/organizationNotes/list';

/**
 * Список внутренних заметок организации (`У-183`, этап 1 ТЗ 12.09.2026, спека
 * docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §3.6).
 *
 * Проверяем: организация вне скоупа или клиентская роль → `not_found` без
 * чтения заметок; закреплённые отделяются от остальных и сортируются по дате
 * закрепления (свежие сверху); флаги `canEdit`/`canDelete` считаются по
 * правилам `policy.ts` для текущей сессии — кнопки рисуются по ним.
 */
const admin = { sub: 'a1', role: 'admin', companyId: 'c1' } as SessionPayload;
const leader = { sub: 'l1', role: 'leader', companyId: 'c1' } as SessionPayload;
const manager = { sub: 'm1', role: 'manager', companyId: 'c1' } as SessionPayload;
const partner = { sub: 'p1', role: 'partner', companyId: 'c1' } as SessionPayload;

const NOW = new Date('2026-09-12T12:00:00.000Z');
const t = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000);

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    body: `текст ${id}`,
    createdAt: t(1),
    updatedAt: t(1),
    pinnedAt: null,
    authorId: 'm1',
    mentionUserIds: [],
    author: { id: 'm1', name: 'Мария' },
    ...over,
  };
}

const orgFindUnique = vi.fn();
const noteFindMany = vi.fn();
const prisma = {
  organization: { findUnique: orgFindUnique },
  organizationNote: { findMany: noteFindMany },
} as unknown as PrismaClient;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  orgFindUnique.mockResolvedValue({ id: 'org1', companyId: 'c1' });
  canManagerAccessOrg.mockResolvedValue(true);
  noteFindMany.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe('listOrganizationNotes', () => {
  it('клиентская роль → not_found, заметки из базы не читаются', async () => {
    const res = await listOrganizationNotes(prisma, partner, 'org1');
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(orgFindUnique).not.toHaveBeenCalled();
    expect(noteFindMany).not.toHaveBeenCalled();
  });

  it('организация чужой компании → not_found (существование не раскрывается)', async () => {
    orgFindUnique.mockResolvedValue({ id: 'org1', companyId: 'c-other' });
    const res = await listOrganizationNotes(prisma, admin, 'org1');
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(noteFindMany).not.toHaveBeenCalled();
  });

  it('менеджер вне охвата → not_found', async () => {
    canManagerAccessOrg.mockResolvedValue(false);
    const res = await listOrganizationNotes(prisma, manager, 'org1');
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(noteFindMany).not.toHaveBeenCalled();
  });

  it('пустая организация → ok с пустыми списками', async () => {
    const res = await listOrganizationNotes(prisma, admin, 'org1');
    expect(res).toEqual({ ok: true, notes: [], pinned: [] });
    expect(noteFindMany).toHaveBeenCalledWith({
      where: { organizationId: 'org1' },
      select: {
        id: true,
        body: true,
        createdAt: true,
        updatedAt: true,
        pinnedAt: true,
        authorId: true,
        mentionUserIds: true,
        author: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('закреплённые отделяются и сортируются по дате закрепления (свежие сверху), остальные — как отдала база', async () => {
    noteFindMany.mockResolvedValue([
      row('n1'),
      row('n2', { pinnedAt: t(10) }),
      row('n3', { pinnedAt: t(2) }),
      row('n4'),
      row('n5', { pinnedAt: t(5) }),
    ]);
    const res = await listOrganizationNotes(prisma, admin, 'org1');
    if (!res.ok) throw new Error('ожидали ok');
    expect(res.notes.map((n) => n.id)).toEqual(['n1', 'n4']);
    expect(res.pinned.map((n) => n.id)).toEqual(['n3', 'n5', 'n2']);
  });

  it('ряды без даты закрепления (undefined) считаются закреплёнными и не роняют сортировку', async () => {
    // Защитная ветка `?? 0` с обеих сторон сравнения: Prisma отдаёт null, но
    // сортировка обязана пережить и отсутствующее поле — такие ряды уходят в
    // конец закреплённых, между собой порядок сохраняют (сортировка стабильна).
    noteFindMany.mockResolvedValue([
      row('n1', { pinnedAt: undefined }),
      row('n2', { pinnedAt: t(1) }),
      row('n3', { pinnedAt: undefined }),
    ]);
    const res = await listOrganizationNotes(prisma, admin, 'org1');
    if (!res.ok) throw new Error('ожидали ok');
    expect(res.notes).toEqual([]);
    expect(res.pinned.map((n) => n.id)).toEqual(['n2', 'n1', 'n3']);
  });

  it('флаги для рядового менеджера: свою свежую правит, чужую — нет, не удаляет ничего', async () => {
    noteFindMany.mockResolvedValue([
      row('mine-fresh', { authorId: 'm1', createdAt: t(23) }),
      row('mine-old', { authorId: 'm1', createdAt: t(25) }),
      row('theirs', { authorId: 'm9', author: { id: 'm9', name: 'Пётр' } }),
    ]);
    const res = await listOrganizationNotes(prisma, manager, 'org1');
    if (!res.ok) throw new Error('ожидали ok');
    const flags = Object.fromEntries(res.notes.map((n) => [n.id, [n.canEdit, n.canDelete]]));
    expect(flags).toEqual({
      'mine-fresh': [true, false],
      'mine-old': [false, false],
      theirs: [false, false],
    });
  });

  it('флаги для старших: руководитель и администратор правят и удаляют любую заметку', async () => {
    noteFindMany.mockResolvedValue([row('old', { authorId: 'm9', createdAt: t(1000) })]);
    for (const session of [leader, admin]) {
      const res = await listOrganizationNotes(prisma, session, 'org1');
      if (!res.ok) throw new Error('ожидали ok');
      expect(res.notes[0]).toMatchObject({ canEdit: true, canDelete: true });
    }
  });
});

describe('toNoteView', () => {
  it('переносит поля один в один, автор может быть null (пользователь удалён)', () => {
    const r = row('n1', { authorId: null, author: null, mentionUserIds: ['u2'], pinnedAt: t(3) });
    const view = toNoteView(manager, r as never, NOW);
    expect(view).toEqual({
      id: 'n1',
      body: 'текст n1',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      pinnedAt: r.pinnedAt,
      author: null,
      mentionUserIds: ['u2'],
      canEdit: false,
      canDelete: false,
    });
  });

  it('считает canEdit относительно переданного «сейчас», а не системных часов', () => {
    const r = row('n1', { authorId: 'm1', createdAt: t(1) });
    const late = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    expect(toNoteView(manager, r as never, NOW).canEdit).toBe(true);
    expect(toNoteView(manager, r as never, late).canEdit).toBe(false);
  });
});
