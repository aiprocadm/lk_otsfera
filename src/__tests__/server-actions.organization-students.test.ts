import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Этап 9 PR-3 (ФТ-12.2): server-action правки должности — тонкий адаптер над
 * сервисом (§3): роль, принадлежность организации сессии, ревалидация карточки.
 */

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getSession }));

const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { updateOrgStudentPosition } = vi.hoisted(() => ({ updateOrgStudentPosition: vi.fn() }));
vi.mock('@/lib/services/organization/students', () => ({ updateOrgStudentPosition }));

import { updateStudentPositionAction } from '@/server-actions/organization/students';

const orgSession = {
  sub: 'u1',
  role: 'organization',
  organizationMemberships: [{ organizationId: 'orgA', isActive: true, roleInOrg: 'admin' }],
} as never;

function fd(over: Record<string, string> = {}): FormData {
  const f = new FormData();
  f.set('organizationId', 'orgA');
  f.set('studentId', 's1');
  f.set('position', 'Инженер');
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  updateOrgStudentPosition.mockResolvedValue({ ok: true, position: 'Инженер' });
});

describe('updateStudentPositionAction', () => {
  it('без сессии и не-организации — forbidden', async () => {
    getSession.mockResolvedValue(null);
    expect(await updateStudentPositionAction(fd())).toEqual({ ok: false, error: 'forbidden' });

    getSession.mockResolvedValue({ sub: 'p', role: 'partner' } as never);
    expect(await updateStudentPositionAction(fd())).toEqual({ ok: false, error: 'forbidden' });
    expect(updateOrgStudentPosition).not.toHaveBeenCalled();
  });

  it('пустые идентификаторы — validation', async () => {
    getSession.mockResolvedValue(orgSession);
    expect(await updateStudentPositionAction(fd({ studentId: '' }))).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(await updateStudentPositionAction(fd({ organizationId: '' }))).toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('поля вообще нет в форме — validation, а не строка «null»', async () => {
    // Экшены зовутся из форм: поле может отсутствовать (старый клиент, ручной
    // вызов). Без запасного значения в сервис ушла бы строка «null».
    getSession.mockResolvedValue(orgSession);
    const noStudent = new FormData();
    noStudent.set('organizationId', 'orgA');
    expect(await updateStudentPositionAction(noStudent)).toEqual({
      ok: false,
      error: 'validation',
    });

    const noOrg = new FormData();
    noOrg.set('studentId', 's1');
    expect(await updateStudentPositionAction(noOrg)).toEqual({ ok: false, error: 'validation' });
    expect(updateOrgStudentPosition).not.toHaveBeenCalled();
  });

  it('чужая организация — forbidden до вызова сервиса', async () => {
    getSession.mockResolvedValue(orgSession);
    const res = await updateStudentPositionAction(fd({ organizationId: 'orgZ' }));
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(updateOrgStudentPosition).not.toHaveBeenCalled();
  });

  it('успех: значение уходит в сервис, карточка ревалидируется', async () => {
    getSession.mockResolvedValue(orgSession);
    const res = await updateStudentPositionAction(fd());
    expect(res).toEqual({ ok: true });
    expect(updateOrgStudentPosition).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'orgA',
      studentId: 's1',
      position: 'Инженер',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/organization/students/s1');
  });

  it('ошибка сервиса пробрасывается без ревалидации', async () => {
    getSession.mockResolvedValue(orgSession);
    updateOrgStudentPosition.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(await updateStudentPositionAction(fd())).toEqual({ ok: false, error: 'forbidden' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('отсутствующее поле position уходит пустой строкой (очистка)', async () => {
    getSession.mockResolvedValue(orgSession);
    const f = new FormData();
    f.set('organizationId', 'orgA');
    f.set('studentId', 's1');
    await updateStudentPositionAction(f);
    expect(updateOrgStudentPosition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ position: '' })
    );
  });
});
