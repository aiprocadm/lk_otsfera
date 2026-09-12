import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit, notifyNoteMention, warn, listColleagues, canManagerAccessOrg } = vi.hoisted(
  () => ({
    recordAudit: vi.fn(),
    notifyNoteMention: vi.fn(),
    warn: vi.fn(),
    listColleagues: vi.fn(),
    canManagerAccessOrg: vi.fn(),
  })
);
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/notifications/noteMention', () => ({ notifyNoteMention }));
vi.mock('@/lib/logging', () => ({ log: { warn, info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/services/staffChat/mentions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/staffChat/mentions')>();
  return { ...actual, listColleagues };
});
vi.mock('@/lib/auth/managerPolicy', () => ({ canManagerAccessOrg }));

import {
  addOrganizationNote,
  editOrganizationNote,
  pinOrganizationNote,
  removeOrganizationNote,
} from '@/lib/services/organizationNotes/mutate';

/**
 * Мутации внутренних заметок организации (`У-183`, этап 1 ТЗ 12.09.2026, спека
 * docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §3.6).
 *
 * Проверяем порядок «право → организация в скоупе → проверка тела → запись →
 * аудит → уведомление»: пустое тело — `invalid`, длиннее 4000 — `note_too_long`;
 * упомянутые ищутся только при «@» и без автора, сбой поиска коллег не роняет
 * заметку; правка оповещает только впервые упомянутых; удаляет только старший;
 * закрепление идемпотентно и ограничено тремя, снятие лимит не проверяет.
 * Чужая и несуществующая заметка снаружи неразличимы (`not_found`).
 */
const admin = { sub: 'a1', role: 'admin', companyId: 'c1' } as SessionPayload;
const leader = { sub: 'l1', role: 'leader', companyId: 'c1' } as SessionPayload;
const manager = { sub: 'm1', role: 'manager', companyId: 'c1' } as SessionPayload;
const partner = { sub: 'p1', role: 'partner', companyId: 'c1' } as SessionPayload;

const NOW = new Date('2026-09-12T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);
const NOTES_PATH = '/manager/organizations/org1?tab=notes';

function makePrisma() {
  return {
    organization: { findUnique: vi.fn().mockResolvedValue({ id: 'org1', companyId: 'c1' }) },
    organizationNote: {
      create: vi.fn().mockResolvedValue({ id: 'n1' }),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}
type MockPrisma = ReturnType<typeof makePrisma>;
const asPrisma = (p: MockPrisma) => p as unknown as PrismaClient;

/** Заметка в базе: своя компания, автор — менеджер m1, создана час назад. */
function storedNote(over: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    organizationId: 'org1',
    companyId: 'c1',
    authorId: 'm1',
    createdAt: hoursAgo(1),
    body: 'старый текст',
    pinnedAt: null,
    mentionUserIds: [],
    ...over,
  };
}

let p: MockPrisma;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  canManagerAccessOrg.mockResolvedValue(true);
  listColleagues.mockResolvedValue({
    ok: true,
    rows: [
      { id: 'm1', name: 'Мария' },
      { id: 'u2', name: 'Пётр' },
      { id: 'u3', name: 'Анна' },
    ],
  });
  notifyNoteMention.mockResolvedValue(0);
  p = makePrisma();
});
afterEach(() => vi.useRealTimers());

describe('addOrganizationNote', () => {
  it('клиентская роль → not_found, запись не создаётся', async () => {
    const res = await addOrganizationNote(asPrisma(p), partner, {
      organizationId: 'org1',
      body: 'текст',
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(p.organizationNote.create).not.toHaveBeenCalled();
  });

  it('организация вне охвата менеджера → not_found', async () => {
    canManagerAccessOrg.mockResolvedValue(false);
    const res = await addOrganizationNote(asPrisma(p), manager, {
      organizationId: 'org1',
      body: 'текст',
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(p.organizationNote.create).not.toHaveBeenCalled();
  });

  it('пустое тело (одни пробелы) → invalid', async () => {
    const res = await addOrganizationNote(asPrisma(p), manager, {
      organizationId: 'org1',
      body: '   ',
    });
    expect(res).toEqual({ ok: false, error: 'invalid' });
    expect(p.organizationNote.create).not.toHaveBeenCalled();
  });

  it('отсутствующее тело (undefined с границы) → invalid, а не исключение', async () => {
    const res = await addOrganizationNote(asPrisma(p), manager, {
      organizationId: 'org1',
      body: undefined as never,
    });
    expect(res).toEqual({ ok: false, error: 'invalid' });
  });

  it('тело длиннее 4000 знаков → note_too_long; ровно 4000 — проходит', async () => {
    const tooLong = await addOrganizationNote(asPrisma(p), manager, {
      organizationId: 'org1',
      body: 'а'.repeat(4001),
    });
    expect(tooLong).toEqual({ ok: false, error: 'note_too_long' });
    expect(p.organizationNote.create).not.toHaveBeenCalled();

    const exact = await addOrganizationNote(asPrisma(p), manager, {
      organizationId: 'org1',
      body: 'а'.repeat(4000),
    });
    expect(exact).toEqual({ ok: true, noteId: 'n1' });
  });

  it('длина считается после обрезки пробелов по краям', async () => {
    const res = await addOrganizationNote(asPrisma(p), manager, {
      organizationId: 'org1',
      body: `  ${'а'.repeat(4000)}  `,
    });
    expect(res).toEqual({ ok: true, noteId: 'n1' });
    expect(p.organizationNote.create.mock.calls[0][0].data.body).toHaveLength(4000);
  });

  it('успех без «@»: запись, аудит, уведомление с пустым списком; коллеги не запрашиваются', async () => {
    const res = await addOrganizationNote(asPrisma(p), manager, {
      organizationId: 'org1',
      body: '  договорились о скидке  ',
    });
    expect(res).toEqual({ ok: true, noteId: 'n1' });
    expect(listColleagues).not.toHaveBeenCalled();
    expect(p.organizationNote.create).toHaveBeenCalledWith({
      data: {
        companyId: 'c1',
        organizationId: 'org1',
        authorId: 'm1',
        body: 'договорились о скидке',
        mentionUserIds: [],
      },
      select: { id: true },
    });
    expect(recordAudit).toHaveBeenCalledWith(asPrisma(p), {
      action: 'organization_note_created',
      entity: 'organization_note',
      entityId: 'n1',
      userId: 'm1',
      after: { organizationId: 'org1' },
    });
    expect(notifyNoteMention).toHaveBeenCalledWith(asPrisma(p), {
      mentionedUserIds: [],
      entity: 'organization',
      entityId: 'org1',
      noteId: 'n1',
      body: 'договорились о скидке',
      managerPath: NOTES_PATH,
    });
  });

  it('упоминания: коллеги ищутся по «@», автор исключается, остальные сохраняются и оповещаются', async () => {
    const res = await addOrganizationNote(asPrisma(p), manager, {
      organizationId: 'org1',
      body: '@Мария и @Пётр, посмотрите @Анна',
    });
    expect(res).toEqual({ ok: true, noteId: 'n1' });
    expect(listColleagues).toHaveBeenCalledWith(asPrisma(p), manager);
    expect(p.organizationNote.create.mock.calls[0][0].data.mentionUserIds).toEqual(['u2', 'u3']);
    expect(notifyNoteMention).toHaveBeenCalledWith(
      asPrisma(p),
      expect.objectContaining({ mentionedUserIds: ['u2', 'u3'], entity: 'organization' })
    );
  });

  it('администратор пишет заметку без проверки охвата', async () => {
    const res = await addOrganizationNote(asPrisma(p), admin, {
      organizationId: 'org1',
      body: 'от администратора',
    });
    expect(res).toEqual({ ok: true, noteId: 'n1' });
    expect(canManagerAccessOrg).not.toHaveBeenCalled();
    expect(p.organizationNote.create.mock.calls[0][0].data.authorId).toBe('a1');
  });

  it('сбой поиска коллег (Error) логируется, заметка сохраняется без упоминаний', async () => {
    listColleagues.mockRejectedValueOnce(new Error('db down'));
    const res = await addOrganizationNote(asPrisma(p), manager, {
      organizationId: 'org1',
      body: '@Пётр глянь',
    });
    expect(res).toEqual({ ok: true, noteId: 'n1' });
    expect(p.organizationNote.create.mock.calls[0][0].data.mentionUserIds).toEqual([]);
    expect(warn).toHaveBeenCalledWith('[organizationNotes] colleagues lookup failed', {
      error: 'db down',
    });
    expect(notifyNoteMention).toHaveBeenCalledWith(
      asPrisma(p),
      expect.objectContaining({ mentionedUserIds: [] })
    );
  });

  it('сбой поиска коллег не-Error значением пишется через String(err)', async () => {
    listColleagues.mockRejectedValueOnce('boom');
    const res = await addOrganizationNote(asPrisma(p), manager, {
      organizationId: 'org1',
      body: '@Пётр',
    });
    expect(res).toEqual({ ok: true, noteId: 'n1' });
    expect(warn).toHaveBeenCalledWith(expect.any(String), { error: 'boom' });
  });
});

describe('loadNote (через editOrganizationNote)', () => {
  it('клиентская роль → not_found, база не читается', async () => {
    const res = await editOrganizationNote(asPrisma(p), partner, { noteId: 'n1', body: 'x' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(p.organizationNote.findUnique).not.toHaveBeenCalled();
  });

  it('заметка не найдена → not_found', async () => {
    p.organizationNote.findUnique.mockResolvedValue(null);
    const res = await editOrganizationNote(asPrisma(p), admin, { noteId: 'ghost', body: 'x' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(p.organizationNote.findUnique).toHaveBeenCalledWith({
      where: { id: 'ghost' },
      select: {
        id: true,
        organizationId: true,
        companyId: true,
        authorId: true,
        createdAt: true,
        body: true,
        pinnedAt: true,
        mentionUserIds: true,
      },
    });
    expect(p.organization.findUnique).not.toHaveBeenCalled();
  });

  it('заметка чужой компании → not_found, организация даже не читается', async () => {
    p.organizationNote.findUnique.mockResolvedValue(storedNote({ companyId: 'c-other' }));
    const res = await editOrganizationNote(asPrisma(p), admin, { noteId: 'n1', body: 'x' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(p.organization.findUnique).not.toHaveBeenCalled();
    expect(p.organizationNote.update).not.toHaveBeenCalled();
  });

  it('организация заметки вне охвата менеджера → not_found', async () => {
    p.organizationNote.findUnique.mockResolvedValue(storedNote());
    canManagerAccessOrg.mockResolvedValue(false);
    const res = await editOrganizationNote(asPrisma(p), manager, { noteId: 'n1', body: 'x' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(p.organization.findUnique).toHaveBeenCalledWith({
      where: { id: 'org1' },
      select: { id: true, companyId: true },
    });
    expect(p.organizationNote.update).not.toHaveBeenCalled();
  });
});

describe('editOrganizationNote', () => {
  beforeEach(() => {
    p.organizationNote.findUnique.mockResolvedValue(storedNote({ mentionUserIds: ['u2'] }));
  });

  it('чужую заметку рядовой менеджер не правит → forbidden (он не автор, «окно» тут ни при чём)', async () => {
    p.organizationNote.findUnique.mockResolvedValue(storedNote({ authorId: 'm9' }));
    const res = await editOrganizationNote(asPrisma(p), manager, { noteId: 'n1', body: 'x' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(p.organizationNote.update).not.toHaveBeenCalled();
  });

  it('свою заметку старше суток автор не правит → note_edit_expired', async () => {
    p.organizationNote.findUnique.mockResolvedValue(storedNote({ createdAt: hoursAgo(25) }));
    const res = await editOrganizationNote(asPrisma(p), manager, { noteId: 'n1', body: 'x' });
    expect(res).toEqual({ ok: false, error: 'note_edit_expired' });
  });

  it('право есть, но тело пустое → invalid; длиннее 4000 → note_too_long', async () => {
    expect(await editOrganizationNote(asPrisma(p), manager, { noteId: 'n1', body: ' ' })).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(
      await editOrganizationNote(asPrisma(p), manager, { noteId: 'n1', body: 'б'.repeat(4001) })
    ).toEqual({ ok: false, error: 'note_too_long' });
    expect(p.organizationNote.update).not.toHaveBeenCalled();
  });

  it('успех автора: запись, аудит, уведомление только впервые упомянутых', async () => {
    // Пётр (u2) уже был упомянут — повторная правка не должна ему спамить; Анна (u3) — новая.
    const res = await editOrganizationNote(asPrisma(p), manager, {
      noteId: 'n1',
      body: ' @Пётр и @Анна, новый текст ',
    });
    expect(res).toEqual({ ok: true, noteId: 'n1' });
    expect(p.organizationNote.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { body: '@Пётр и @Анна, новый текст', mentionUserIds: ['u2', 'u3'] },
    });
    expect(recordAudit).toHaveBeenCalledWith(asPrisma(p), {
      action: 'organization_note_updated',
      entity: 'organization_note',
      entityId: 'n1',
      userId: 'm1',
      after: { organizationId: 'org1' },
    });
    expect(notifyNoteMention).toHaveBeenCalledWith(asPrisma(p), {
      mentionedUserIds: ['u3'],
      entity: 'organization',
      entityId: 'org1',
      noteId: 'n1',
      body: '@Пётр и @Анна, новый текст',
      managerPath: NOTES_PATH,
    });
  });

  it('правка без упоминаний очищает список упомянутых и никого не оповещает', async () => {
    const res = await editOrganizationNote(asPrisma(p), manager, {
      noteId: 'n1',
      body: 'просто текст',
    });
    expect(res).toEqual({ ok: true, noteId: 'n1' });
    expect(listColleagues).not.toHaveBeenCalled();
    expect(p.organizationNote.update.mock.calls[0][0].data.mentionUserIds).toEqual([]);
    expect(notifyNoteMention).toHaveBeenCalledWith(
      asPrisma(p),
      expect.objectContaining({ mentionedUserIds: [] })
    );
  });

  it('руководитель правит чужую старую заметку', async () => {
    p.organizationNote.findUnique.mockResolvedValue(
      storedNote({ authorId: 'm9', createdAt: hoursAgo(1000) })
    );
    const res = await editOrganizationNote(asPrisma(p), leader, { noteId: 'n1', body: 'правка' });
    expect(res).toEqual({ ok: true, noteId: 'n1' });
    expect(recordAudit).toHaveBeenCalledWith(
      asPrisma(p),
      expect.objectContaining({ action: 'organization_note_updated', userId: 'l1' })
    );
  });
});

describe('removeOrganizationNote', () => {
  it('заметка не найдена → not_found', async () => {
    p.organizationNote.findUnique.mockResolvedValue(null);
    const res = await removeOrganizationNote(asPrisma(p), admin, { noteId: 'ghost' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(p.organizationNote.delete).not.toHaveBeenCalled();
  });

  it('рядовой менеджер не удаляет даже свою заметку → forbidden', async () => {
    p.organizationNote.findUnique.mockResolvedValue(storedNote());
    const res = await removeOrganizationNote(asPrisma(p), manager, { noteId: 'n1' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(p.organizationNote.delete).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('старший удаляет; тело уходит в before аудита для восстановления', async () => {
    p.organizationNote.findUnique.mockResolvedValue(storedNote({ authorId: 'm9' }));
    for (const session of [leader, admin]) {
      vi.clearAllMocks();
      const res = await removeOrganizationNote(asPrisma(p), session, { noteId: 'n1' });
      expect(res).toEqual({ ok: true, noteId: 'n1' });
      expect(p.organizationNote.delete).toHaveBeenCalledWith({ where: { id: 'n1' } });
      expect(recordAudit).toHaveBeenCalledWith(asPrisma(p), {
        action: 'organization_note_deleted',
        entity: 'organization_note',
        entityId: 'n1',
        userId: session.sub,
        before: { organizationId: 'org1', body: 'старый текст' },
      });
    }
  });
});

describe('pinOrganizationNote', () => {
  it('заметка не найдена → not_found', async () => {
    p.organizationNote.findUnique.mockResolvedValue(null);
    const res = await pinOrganizationNote(asPrisma(p), manager, { noteId: 'ghost', pinned: true });
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(p.organizationNote.update).not.toHaveBeenCalled();
  });

  it('идемпотентно: уже закреплённую закрепить → ok без записи, лимит не считается', async () => {
    p.organizationNote.findUnique.mockResolvedValue(storedNote({ pinnedAt: hoursAgo(2) }));
    const res = await pinOrganizationNote(asPrisma(p), manager, { noteId: 'n1', pinned: true });
    expect(res).toEqual({ ok: true, noteId: 'n1' });
    expect(p.organizationNote.count).not.toHaveBeenCalled();
    expect(p.organizationNote.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('идемпотентно: незакреплённую снять → ok без записи', async () => {
    p.organizationNote.findUnique.mockResolvedValue(storedNote());
    const res = await pinOrganizationNote(asPrisma(p), manager, { noteId: 'n1', pinned: false });
    expect(res).toEqual({ ok: true, noteId: 'n1' });
    expect(p.organizationNote.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('уже три закреплённых → note_pin_limit, запись не меняется', async () => {
    p.organizationNote.findUnique.mockResolvedValue(storedNote());
    p.organizationNote.count.mockResolvedValue(3);
    const res = await pinOrganizationNote(asPrisma(p), manager, { noteId: 'n1', pinned: true });
    expect(res).toEqual({ ok: false, error: 'note_pin_limit' });
    expect(p.organizationNote.count).toHaveBeenCalledWith({
      where: { organizationId: 'org1', pinnedAt: { not: null } },
    });
    expect(p.organizationNote.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('закрепление при двух закреплённых: pinnedAt = сейчас, аудит pinned:true', async () => {
    p.organizationNote.findUnique.mockResolvedValue(storedNote());
    p.organizationNote.count.mockResolvedValue(2);
    const res = await pinOrganizationNote(asPrisma(p), manager, { noteId: 'n1', pinned: true });
    expect(res).toEqual({ ok: true, noteId: 'n1' });
    expect(p.organizationNote.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { pinnedAt: NOW },
    });
    expect(recordAudit).toHaveBeenCalledWith(asPrisma(p), {
      action: 'organization_note_pinned',
      entity: 'organization_note',
      entityId: 'n1',
      userId: 'm1',
      after: { organizationId: 'org1', pinned: true },
    });
  });

  it('снятие закрепления не проверяет лимит: pinnedAt = null, аудит pinned:false', async () => {
    p.organizationNote.findUnique.mockResolvedValue(storedNote({ pinnedAt: hoursAgo(2) }));
    p.organizationNote.count.mockResolvedValue(3);
    const res = await pinOrganizationNote(asPrisma(p), manager, { noteId: 'n1', pinned: false });
    expect(res).toEqual({ ok: true, noteId: 'n1' });
    expect(p.organizationNote.count).not.toHaveBeenCalled();
    expect(p.organizationNote.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { pinnedAt: null },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      asPrisma(p),
      expect.objectContaining({
        action: 'organization_note_pinned',
        after: { organizationId: 'org1', pinned: false },
      })
    );
  });

  it('закреплять может любой, кто пишет: рядовой менеджер не получает forbidden', async () => {
    p.organizationNote.findUnique.mockResolvedValue(storedNote({ authorId: 'm9' }));
    const res = await pinOrganizationNote(asPrisma(p), manager, { noteId: 'n1', pinned: true });
    expect(res).toEqual({ ok: true, noteId: 'n1' });
  });
});
