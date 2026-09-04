/**
 * Этап 8 (PR-4) — тонкий адаптер правила выгрузки в 1С (`У-169`): гард
 * раздела `catalogs.requisites` своего кабинета до сервиса, разбор формы
 * (radio `mode`, все `types` чекбоксов), ревалидация обоих хабов только при
 * успехе, отказ сервиса — как есть.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSettingsSection, updateOneCDocumentPushRule } = vi.hoisted(() => ({
  requireSettingsSection: vi.fn(),
  updateOneCDocumentPushRule: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));
vi.mock('@/lib/services/admin/oneCDocumentPushRule', () => ({ updateOneCDocumentPushRule }));

import { revalidatePath } from 'next/cache';
import { setOneCDocumentPushRuleAction } from '@/server-actions/admin/oneCDocumentPushRule';

const LEADER = { sub: 'l1', role: 'leader', companyId: 'co-1' };

function fd(entries: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) v.forEach((item) => f.append(k, item));
    else f.set(k, v);
  }
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSettingsSection.mockResolvedValue(LEADER);
  updateOneCDocumentPushRule.mockResolvedValue({ ok: true });
});

describe('setOneCDocumentPushRuleAction', () => {
  it('спрашивает право catalogs.requisites своего кабинета и передаёт сессию сервису', async () => {
    await setOneCDocumentPushRuleAction('admin', fd({ companyId: 'co-1', mode: 'auto' }));
    expect(requireSettingsSection).toHaveBeenCalledWith('catalogs.requisites', 'admin');
    expect(updateOneCDocumentPushRule).toHaveBeenCalledWith({}, LEADER, 'co-1', {
      mode: 'auto',
      types: [],
    });
  });

  it('отказ гарда — до сервиса', async () => {
    requireSettingsSection.mockRejectedValue(new Error('REDIRECT:/forbidden'));
    await expect(
      setOneCDocumentPushRuleAction('leader', fd({ companyId: 'co-1', mode: 'auto' }))
    ).rejects.toThrow('REDIRECT:/forbidden');
    expect(updateOneCDocumentPushRule).not.toHaveBeenCalled();
  });

  it('разбирает все отмеченные типы и ревалидирует оба хаба при успехе', async () => {
    const res = await setOneCDocumentPushRuleAction(
      'leader',
      fd({ companyId: 'co-1', mode: 'manual', types: ['invoice', 'contract'] })
    );
    expect(res).toEqual({ ok: true });
    expect(updateOneCDocumentPushRule).toHaveBeenCalledWith({}, LEADER, 'co-1', {
      mode: 'manual',
      types: ['invoice', 'contract'],
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/settings');
  });

  it('без companyId → validation, сервис не зовётся', async () => {
    expect(await setOneCDocumentPushRuleAction('leader', fd({ mode: 'auto' }))).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(updateOneCDocumentPushRule).not.toHaveBeenCalled();
  });

  it('отказ сервиса возвращается как есть, без ревалидации', async () => {
    updateOneCDocumentPushRule.mockResolvedValue({ ok: false, error: 'invalid_types' });
    expect(
      await setOneCDocumentPushRuleAction(
        'admin',
        fd({ companyId: 'co-1', mode: 'auto', types: ['commercial_proposal'] })
      )
    ).toEqual({ ok: false, error: 'invalid_types' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
