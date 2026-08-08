/**
 * Добор покрытия для «тонких» server-actions админки и очереди корректировок.
 *
 * Закрываем ветки условных спредов `...(x !== undefined ? { x } : {})`, которые
 * существующие тесты не задевали: они дёргали только обязательные поля формы,
 * поэтому необязательные (`partnerId`, `isActive`, `reason`) всегда приходили
 * пустыми и ветка «поле заполнено» ни разу не исполнялась.
 *
 * Проверяем поведение: какой ИМЕННО набор ключей уходит в сервис (наличие ключа
 * и его отсутствие — разные вещи из-за exactOptionalPropertyTypes: Prisma-слой
 * различает «не трогать поле» и «записать undefined»).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdmin,
  requireSession,
  createUser,
  updateUser,
  deactivateUser,
  reactivateUser,
  adminRegenerateBackupCodes,
  createPartnerWithAdmin,
  updatePartner,
  deactivatePartner,
  reactivatePartner,
  resolveCorrection,
  sendAdminUserInviteEmail,
  revalidatePath,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireSession: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
  adminRegenerateBackupCodes: vi.fn(),
  createPartnerWithAdmin: vi.fn(),
  updatePartner: vi.fn(),
  deactivatePartner: vi.fn(),
  reactivatePartner: vi.fn(),
  resolveCorrection: vi.fn(),
  sendAdminUserInviteEmail: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin, requireSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/email/send', () => ({ sendAdminUserInviteEmail }));
vi.mock('@/lib/services/commission/corrections', () => ({ resolveCorrection }));

vi.mock('@/lib/services/admin/users', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/admin/users')>(
    '@/lib/services/admin/users'
  );
  return {
    ...actual,
    createUser,
    updateUser,
    deactivateUser,
    reactivateUser,
    adminRegenerateBackupCodes,
  };
});

vi.mock('@/lib/services/admin/partners', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/admin/partners')>(
    '@/lib/services/admin/partners'
  );
  return {
    ...actual,
    createPartnerWithAdmin,
    updatePartner,
    deactivatePartner,
    reactivatePartner,
  };
});

import { createUserAction, updateUserAction } from '@/server-actions/admin/users';
import { updatePartnerAction } from '@/server-actions/admin/partners';
import { resolveCorrectionAction } from '@/server-actions/commission/corrections';

function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ sub: 'admin-1', name: 'Admin User' });
  requireSession.mockResolvedValue({ sub: 'leader-1', role: 'manager' });
  sendAdminUserInviteEmail.mockResolvedValue({ status: 'sent', id: null });
});

describe('updateUserAction — необязательные поля доезжают до сервиса', () => {
  it('передаёт partnerId, когда поле формы заполнено', async () => {
    updateUser.mockResolvedValue({ ok: true });

    const res = await updateUserAction(fd({ id: 'u-1', partnerId: 'p-77' }));

    expect(res).toEqual({ ok: true });
    const args = updateUser.mock.calls[0][3];
    expect(args).toEqual({ partnerId: 'p-77' });
    // Ключи, которых в форме не было, не должны появиться даже как undefined.
    expect(Object.keys(args).sort()).toEqual(['partnerId']);
  });

  it('передаёт isActive, когда поле формы заполнено', async () => {
    updateUser.mockResolvedValue({ ok: true });

    const res = await updateUserAction(fd({ id: 'u-2', isActive: 'on' }));

    expect(res).toEqual({ ok: true });
    const args = updateUser.mock.calls[0][3];
    expect(args).toEqual({ isActive: true });
    expect(Object.keys(args).sort()).toEqual(['isActive']);
  });

  it('передаёт все необязательные поля разом', async () => {
    updateUser.mockResolvedValue({ ok: true });

    await updateUserAction(
      fd({ id: 'u-3', name: 'Новое имя', role: 'manager', partnerId: 'p-9', isActive: 'on' })
    );

    expect(updateUser.mock.calls[0][3]).toEqual({
      name: 'Новое имя',
      role: 'manager',
      partnerId: 'p-9',
      isActive: true,
    });
  });
});

describe('createUserAction — ключ partnerId уходит в сервис всегда', () => {
  // Инвариант, на который опирается v8-ignore в users.ts: форма читается через
  // readField() + `|| null`, поэтому partnerId — это строка или null, но НИКОГДА
  // не undefined; ветка «ключа нет» недостижима.
  it('без partnerId в форме сервис получает partnerId: null', async () => {
    createUser.mockResolvedValue({
      ok: true,
      user: { id: 'u-4', email: 'a@t.local' },
      inviteToken: 'tok',
    });

    await createUserAction(fd({ email: 'a@t.local', name: 'A', role: 'organization' }));

    const args = createUser.mock.calls[0][2];
    expect(args).toHaveProperty('partnerId', null);
    expect(Object.keys(args).sort()).toEqual(['email', 'name', 'partnerId', 'role']);
  });
});

describe('updatePartnerAction — флаг активности доезжает до сервиса', () => {
  it('передаёт isActive, когда поле формы заполнено', async () => {
    updatePartner.mockResolvedValue({ ok: true });

    const res = await updatePartnerAction(fd({ id: 'pt-1', isActive: 'on' }));

    expect(res).toEqual({ ok: true });
    const args = updatePartner.mock.calls[0][3];
    expect(args).toEqual({ isActive: true });
    expect(Object.keys(args).sort()).toEqual(['isActive']);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/partners/pt-1');
  });
});

describe('resolveCorrectionAction — причина доезжает до сервиса', () => {
  it('передаёт reason при списании (waive)', async () => {
    resolveCorrection.mockResolvedValue({ ok: true });

    const res = await resolveCorrectionAction(
      fd({ correctionId: 'c-5', action: 'waive', reason: 'Ошибка выгрузки 1С' })
    );

    expect(res).toEqual({ ok: true });
    expect(resolveCorrection.mock.calls[0][2]).toEqual({
      correctionId: 'c-5',
      action: 'waive',
      reason: 'Ошибка выгрузки 1С',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/leader/commission-corrections');
  });

  it('без причины ключ reason в сервис не уходит', async () => {
    resolveCorrection.mockResolvedValue({ ok: true });

    await resolveCorrectionAction(fd({ correctionId: 'c-6', action: 'apply' }));

    expect(Object.keys(resolveCorrection.mock.calls[0][2]).sort()).toEqual([
      'action',
      'correctionId',
    ]);
  });
});
