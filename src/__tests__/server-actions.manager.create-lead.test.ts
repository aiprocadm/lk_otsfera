import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Ф1 программы погашения долга покрытия (spec 2026-07-30-coverage-debt-design.md):
 * файл был на 0%. Это не «дырка в проценте», а непроверенный путь ручного
 * создания лида сотрудником (этап 5, ФТ-1.6).
 *
 * Экшен — тонкий адаптер (§3 CLAUDE.md): роль и скоуп проверяет сервис, экшен
 * обязан лишь взять сессию, позвать сервис и честно перенести код ошибки —
 * включая необязательный `messages`, который не должен появляться в ответе,
 * если сервис его не вернул.
 */

const { requireSession, createLeadByStaff } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  createLeadByStaff: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/manager/createLead', () => ({ createLeadByStaff }));

import { createLeadByStaffAction } from '@/server-actions/manager/create-lead';

const MGR = { sub: 'mgr-1', role: 'manager', managedOrgIds: [], companyId: 'co-1' };
const INPUT = { name: 'Иван Иванов', phone: '+79991234567' } as never;

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(MGR);
});

describe('createLeadByStaffAction', () => {
  it('успех: отдаёт id созданного лида, сессию берёт до вызова сервиса', async () => {
    createLeadByStaff.mockResolvedValue({ ok: true, lead: { id: 'lead-1' } });

    const res = await createLeadByStaffAction(INPUT);

    expect(res).toEqual({ ok: true, leadId: 'lead-1' });
    expect(requireSession).toHaveBeenCalledTimes(1);
    expect(createLeadByStaff).toHaveBeenCalledWith({}, MGR, INPUT);
  });

  it('forbidden от сервиса переносится как есть — экшен своей проверки роли не делает', async () => {
    createLeadByStaff.mockResolvedValue({ ok: false, error: 'forbidden' });

    const res = await createLeadByStaffAction(INPUT);

    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(res).not.toHaveProperty('messages');
  });

  it('validation с messages: список причин доходит до формы', async () => {
    createLeadByStaff.mockResolvedValue({
      ok: false,
      error: 'validation',
      messages: ['Укажите телефон', 'Имя слишком короткое'],
    });

    const res = await createLeadByStaffAction(INPUT);

    expect(res).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Укажите телефон', 'Имя слишком короткое'],
    });
  });

  it('validation без messages: ключ messages не появляется (а не undefined)', async () => {
    createLeadByStaff.mockResolvedValue({ ok: false, error: 'validation' });

    const res = await createLeadByStaffAction(INPUT);

    expect(Object.keys(res)).toEqual(['ok', 'error']);
  });

  it('нет сессии — падение requireSession не глушится (редирект на логин делает гард)', async () => {
    requireSession.mockRejectedValue(new Error('NEXT_REDIRECT'));

    await expect(createLeadByStaffAction(INPUT)).rejects.toThrow('NEXT_REDIRECT');
    expect(createLeadByStaff).not.toHaveBeenCalled();
  });
});
