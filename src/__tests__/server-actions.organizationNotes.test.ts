import { it, expect, vi, beforeEach } from 'vitest';

const { requireSession, revalidatePath, add, edit, remove, pin } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  add: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  pin: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/organizationNotes/mutate', () => ({
  addOrganizationNote: add,
  editOrganizationNote: edit,
  removeOrganizationNote: remove,
  pinOrganizationNote: pin,
}));

import {
  addOrganizationNoteAction,
  editOrganizationNoteAction,
  pinOrganizationNoteAction,
  removeOrganizationNoteAction,
} from '@/server-actions/organizationNotes';

/**
 * Server actions внутренних заметок (этап 1 ТЗ 12.09.2026, PR-1, спека §3.6):
 * форма — zod → `validation`; роль и скоуп решает сервис; после удачной записи
 * перечитываются карточки организации в трёх кабинетах ЦО.
 */
const session = { sub: 'm1', role: 'manager', companyId: 'c1' };
const orgPaths = [
  '/manager/organizations/o1',
  '/leader/organizations/o1',
  '/admin/organizations/o1',
];

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(session);
});

it('кривая форма → validation без сессии и сервиса', async () => {
  expect(await addOrganizationNoteAction({ organizationId: '', body: 'x' })).toEqual({
    ok: false,
    error: 'validation',
  });
  expect(await editOrganizationNoteAction({ noteId: '', organizationId: 'o1', body: 'x' })).toEqual(
    {
      ok: false,
      error: 'validation',
    }
  );
  expect(await removeOrganizationNoteAction({ noteId: 'n1', organizationId: '' })).toEqual({
    ok: false,
    error: 'validation',
  });
  expect(
    await pinOrganizationNoteAction({ noteId: 'n1', organizationId: 'o1', pinned: 'yes' as never })
  ).toEqual({
    ok: false,
    error: 'validation',
  });
  expect(requireSession).not.toHaveBeenCalled();
  expect(add).not.toHaveBeenCalled();
});

it('гигантское тело отсекается формой, обычное — доходит до сервиса (предел считает сервис)', async () => {
  expect(await addOrganizationNoteAction({ organizationId: 'o1', body: 'x'.repeat(8001) })).toEqual(
    {
      ok: false,
      error: 'validation',
    }
  );
  add.mockResolvedValue({ ok: false, error: 'note_too_long' });
  expect(await addOrganizationNoteAction({ organizationId: 'o1', body: 'x'.repeat(4001) })).toEqual(
    {
      ok: false,
      error: 'note_too_long',
    }
  );
  expect(revalidatePath).not.toHaveBeenCalled();
});

it('addOrganizationNoteAction: сервис с сессией и формой, перечитывание трёх карточек', async () => {
  add.mockResolvedValue({ ok: true, noteId: 'n1' });
  expect(await addOrganizationNoteAction({ organizationId: 'o1', body: 'важно' })).toEqual({
    ok: true,
    noteId: 'n1',
  });
  expect(add).toHaveBeenCalledWith({}, session, { organizationId: 'o1', body: 'важно' });
  for (const p of orgPaths) expect(revalidatePath).toHaveBeenCalledWith(p);
});

it('editOrganizationNoteAction: organizationId нужен только для перечитывания, сервису не передаётся', async () => {
  edit.mockResolvedValue({ ok: true, noteId: 'n1' });
  expect(
    await editOrganizationNoteAction({ noteId: 'n1', organizationId: 'o1', body: 'новое' })
  ).toEqual({
    ok: true,
    noteId: 'n1',
  });
  expect(edit).toHaveBeenCalledWith({}, session, { noteId: 'n1', body: 'новое' });
  for (const p of orgPaths) expect(revalidatePath).toHaveBeenCalledWith(p);
});

it('removeOrganizationNoteAction и pinOrganizationNoteAction: успех перечитывает, отказ — нет', async () => {
  remove.mockResolvedValue({ ok: false, error: 'forbidden' });
  expect(await removeOrganizationNoteAction({ noteId: 'n1', organizationId: 'o1' })).toEqual({
    ok: false,
    error: 'forbidden',
  });
  expect(revalidatePath).not.toHaveBeenCalled();

  remove.mockResolvedValue({ ok: true, noteId: 'n1' });
  expect(await removeOrganizationNoteAction({ noteId: 'n1', organizationId: 'o1' })).toEqual({
    ok: true,
    noteId: 'n1',
  });
  expect(remove).toHaveBeenCalledWith({}, session, { noteId: 'n1' });

  pin.mockResolvedValue({ ok: false, error: 'note_pin_limit' });
  expect(
    await pinOrganizationNoteAction({ noteId: 'n1', organizationId: 'o1', pinned: true })
  ).toEqual({
    ok: false,
    error: 'note_pin_limit',
  });
  pin.mockResolvedValue({ ok: true, noteId: 'n1' });
  expect(
    await pinOrganizationNoteAction({ noteId: 'n1', organizationId: 'o1', pinned: false })
  ).toEqual({
    ok: true,
    noteId: 'n1',
  });
  expect(pin).toHaveBeenLastCalledWith({}, session, { noteId: 'n1', pinned: false });
  expect(revalidatePath.mock.calls.filter((c) => c[0] === '/admin/organizations/o1')).toHaveLength(
    2
  );
});
