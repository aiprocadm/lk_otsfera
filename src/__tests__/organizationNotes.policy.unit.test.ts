import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { canManagerAccessOrg } = vi.hoisted(() => ({ canManagerAccessOrg: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ canManagerAccessOrg }));

import {
  NOTE_BODY_MAX,
  NOTE_EDIT_WINDOW_MS,
  NOTE_PIN_LIMIT,
  canAccessOrgNotes,
  canDeleteNote,
  canEditNote,
  isNoteSupervisor,
  orgAccessibleForNotes,
} from '@/lib/services/organizationNotes/policy';

/**
 * Правила внутренних заметок организации (`У-183`, этап 1 ТЗ 12.09.2026, спека
 * docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §3.6).
 *
 * Проверяем, кто видит и правит заметки: клиентские роли и сотрудники без
 * компании — никто; автор правит ровно сутки, руководитель и администратор —
 * всегда; удаляет только старший. Организация доступна только своей компании,
 * рядовому менеджеру и руководителю — ещё и по охвату (`canManagerAccessOrg`),
 * администратору охват не проверяется.
 */
const admin = { sub: 'a1', role: 'admin', companyId: 'c1' } as SessionPayload;
const leader = { sub: 'l1', role: 'leader', companyId: 'c1' } as SessionPayload;
const manager = { sub: 'm1', role: 'manager', companyId: 'c1' } as SessionPayload;
const partner = { sub: 'p1', role: 'partner', companyId: 'c1' } as SessionPayload;
const orgUser = { sub: 'o1', role: 'organization', companyId: 'c1' } as SessionPayload;
const managerNoCompany = { sub: 'm2', role: 'manager', companyId: null } as SessionPayload;

describe('константы правил', () => {
  it('предел длины 4000, закреплённых не больше трёх, окно правки — сутки', () => {
    expect(NOTE_BODY_MAX).toBe(4000);
    expect(NOTE_PIN_LIMIT).toBe(3);
    expect(NOTE_EDIT_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('canAccessOrgNotes', () => {
  it('сотрудники ЦО своей компании видят заметки: администратор, руководитель, менеджер', () => {
    expect(canAccessOrgNotes(admin)).toBe(true);
    expect(canAccessOrgNotes(leader)).toBe(true);
    expect(canAccessOrgNotes(manager)).toBe(true);
  });

  it('клиентские роли не видят заметки даже при companyId', () => {
    expect(canAccessOrgNotes(partner)).toBe(false);
    expect(canAccessOrgNotes(orgUser)).toBe(false);
  });

  it('сотрудник без компании не видит ничего — заметки живут внутри компании', () => {
    expect(canAccessOrgNotes(managerNoCompany)).toBe(false);
    expect(canAccessOrgNotes({ sub: 'a2', role: 'admin' } as SessionPayload)).toBe(false);
  });
});

describe('isNoteSupervisor / canDeleteNote', () => {
  it('старшие — администратор и руководитель; рядовой менеджер — нет', () => {
    expect(isNoteSupervisor(admin)).toBe(true);
    expect(isNoteSupervisor(leader)).toBe(true);
    expect(isNoteSupervisor(manager)).toBe(false);
  });

  it('удаляет только старший (умолчание В-1-3)', () => {
    expect(canDeleteNote(admin)).toBe(true);
    expect(canDeleteNote(leader)).toBe(true);
    expect(canDeleteNote(manager)).toBe(false);
    expect(canDeleteNote(partner)).toBe(false);
  });
});

describe('canEditNote', () => {
  const createdAt = new Date('2026-09-12T10:00:00.000Z');

  it('старший правит любую заметку в любое время', () => {
    const ancient = new Date(createdAt.getTime() + 365 * 24 * 60 * 60 * 1000);
    expect(canEditNote(admin, { authorId: 'someone', createdAt }, ancient)).toBe(true);
    expect(canEditNote(leader, { authorId: null, createdAt }, ancient)).toBe(true);
  });

  it('автор правит свою заметку ровно до конца суток включительно', () => {
    const edge = new Date(createdAt.getTime() + NOTE_EDIT_WINDOW_MS);
    expect(canEditNote(manager, { authorId: 'm1', createdAt }, createdAt)).toBe(true);
    expect(canEditNote(manager, { authorId: 'm1', createdAt }, edge)).toBe(true);
  });

  it('спустя сутки и одну миллисекунду автор уже не правит', () => {
    const late = new Date(createdAt.getTime() + NOTE_EDIT_WINDOW_MS + 1);
    expect(canEditNote(manager, { authorId: 'm1', createdAt }, late)).toBe(false);
  });

  it('чужую заметку рядовой менеджер не правит даже сразу после создания', () => {
    expect(canEditNote(manager, { authorId: 'm9', createdAt }, createdAt)).toBe(false);
    expect(canEditNote(manager, { authorId: null, createdAt }, createdAt)).toBe(false);
  });

  describe('без явного «сейчас»', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-12T12:00:00.000Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('берёт текущее время: свежая заметка автора доступна, вчерашняя — нет', () => {
      const fresh = new Date('2026-09-12T11:00:00.000Z');
      const yesterday = new Date('2026-09-11T11:59:59.999Z');
      expect(canEditNote(manager, { authorId: 'm1', createdAt: fresh })).toBe(true);
      expect(canEditNote(manager, { authorId: 'm1', createdAt: yesterday })).toBe(false);
    });
  });
});

describe('orgAccessibleForNotes', () => {
  const findUnique = vi.fn();
  const prisma = { organization: { findUnique } } as unknown as PrismaClient;

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue({ id: 'org1', companyId: 'c1' });
    canManagerAccessOrg.mockResolvedValue(true);
  });

  it('клиентская роль → null без обращения к базе', async () => {
    expect(await orgAccessibleForNotes(prisma, partner, 'org1')).toBeNull();
    expect(await orgAccessibleForNotes(prisma, orgUser, 'org1')).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
    expect(canManagerAccessOrg).not.toHaveBeenCalled();
  });

  it('сотрудник без компании → null без обращения к базе', async () => {
    expect(await orgAccessibleForNotes(prisma, managerNoCompany, 'org1')).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('организация не найдена → null, охват не проверяется', async () => {
    findUnique.mockResolvedValue(null);
    expect(await orgAccessibleForNotes(prisma, admin, 'ghost')).toBeNull();
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'ghost' },
      select: { id: true, companyId: true },
    });
    expect(canManagerAccessOrg).not.toHaveBeenCalled();
  });

  it('организация без компании → null (ничья организация никому не доступна)', async () => {
    findUnique.mockResolvedValue({ id: 'org1', companyId: null });
    expect(await orgAccessibleForNotes(prisma, admin, 'org1')).toBeNull();
    expect(canManagerAccessOrg).not.toHaveBeenCalled();
  });

  it('организация чужой компании → null даже для администратора', async () => {
    findUnique.mockResolvedValue({ id: 'org1', companyId: 'c-other' });
    expect(await orgAccessibleForNotes(prisma, admin, 'org1')).toBeNull();
    expect(await orgAccessibleForNotes(prisma, manager, 'org1')).toBeNull();
    expect(canManagerAccessOrg).not.toHaveBeenCalled();
  });

  it('администратор своей компании получает организацию без проверки охвата', async () => {
    expect(await orgAccessibleForNotes(prisma, admin, 'org1')).toEqual({
      id: 'org1',
      companyId: 'c1',
    });
    expect(canManagerAccessOrg).not.toHaveBeenCalled();
  });

  it('менеджер с охватом получает организацию; охват спрашивается у canManagerAccessOrg', async () => {
    expect(await orgAccessibleForNotes(prisma, manager, 'org1')).toEqual({
      id: 'org1',
      companyId: 'c1',
    });
    expect(canManagerAccessOrg).toHaveBeenCalledWith(prisma, manager, 'org1');
  });

  it('менеджер без охвата → null', async () => {
    canManagerAccessOrg.mockResolvedValue(false);
    expect(await orgAccessibleForNotes(prisma, manager, 'org1')).toBeNull();
    expect(canManagerAccessOrg).toHaveBeenCalledOnce();
  });

  it('руководитель тоже идёт через canManagerAccessOrg — лидер-инвариант живёт там', async () => {
    expect(await orgAccessibleForNotes(prisma, leader, 'org1')).toEqual({
      id: 'org1',
      companyId: 'c1',
    });
    expect(canManagerAccessOrg).toHaveBeenCalledWith(prisma, leader, 'org1');
  });
});
