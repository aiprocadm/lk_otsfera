import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  requireSettingsSection: vi.fn(),
  revalidatePath: vi.fn(),
  saveReplyTemplate: vi.fn(),
  deleteReplyTemplate: vi.fn(),
}));
vi.mock('@/lib/auth/requireSettings', () => ({
  requireSettingsSection: m.requireSettingsSection,
}));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/replyTemplates/crud', () => ({
  saveReplyTemplate: m.saveReplyTemplate,
  deleteReplyTemplate: m.deleteReplyTemplate,
}));

import {
  deleteReplyTemplateAction,
  saveReplyTemplateAction,
} from '@/server-actions/replyTemplates';

/**
 * Тонкие адаптеры раздела «Шаблоны ответов» (`У-208`): форма входа → право
 * раздела → сервис → перечитывание обеих зеркальных страниц.
 *
 * Право проверяется на КАЖДЫЙ запрос и именно по id раздела: скрытая карточка
 * в хабе — это внешний вид, а не защита (§4 CLAUDE.md).
 */
const SESSION = { sub: 'me', role: 'leader', companyId: 'c1' };

const VALID_SAVE = {
  id: null,
  title: 'Приветствие',
  body: 'Здравствуйте!',
  channels: ['telegram'],
  isActive: true,
  sortOrder: 0,
};

describe('server-actions/replyTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.requireSettingsSection.mockResolvedValue(SESSION);
    m.saveReplyTemplate.mockResolvedValue({ ok: true, id: 't1' });
    m.deleteReplyTemplate.mockResolvedValue({ ok: true });
  });

  it('оба действия спрашивают право раздела catalogs.replyTemplates для переданного кабинета', async () => {
    await saveReplyTemplateAction({ ...VALID_SAVE, cabinet: 'leader' });
    expect(m.requireSettingsSection).toHaveBeenCalledWith('catalogs.replyTemplates', 'leader');

    m.requireSettingsSection.mockClear();
    await deleteReplyTemplateAction({ id: 't1', cabinet: 'admin' });
    expect(m.requireSettingsSection).toHaveBeenCalledWith('catalogs.replyTemplates', 'admin');
  });

  it('кабинет не передан → проверяется кабинет админа', async () => {
    await saveReplyTemplateAction(VALID_SAVE);
    expect(m.requireSettingsSection).toHaveBeenCalledWith('catalogs.replyTemplates', 'admin');
  });

  it('кривая форма входа → validation, до гарда и сервиса дело не доходит', async () => {
    await expect(saveReplyTemplateAction({ ...VALID_SAVE, id: '' })).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
    await expect(
      saveReplyTemplateAction({ ...VALID_SAVE, cabinet: 'manager' as never })
    ).resolves.toEqual({ ok: false, error: 'validation' });
    await expect(saveReplyTemplateAction({ ...VALID_SAVE, sortOrder: 1.5 })).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
    await expect(deleteReplyTemplateAction({ id: '' })).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
    expect(m.requireSettingsSection).not.toHaveBeenCalled();
    expect(m.saveReplyTemplate).not.toHaveBeenCalled();
    expect(m.deleteReplyTemplate).not.toHaveBeenCalled();
  });

  it('сохранение: сервис зовётся с сессией гарда, кабинет в сервис не протекает', async () => {
    await saveReplyTemplateAction({ ...VALID_SAVE, cabinet: 'leader' });
    expect(m.saveReplyTemplate).toHaveBeenCalledWith({}, SESSION, VALID_SAVE);
  });

  it('успех перечитывает обе зеркальные страницы — админа и руководителя', async () => {
    await saveReplyTemplateAction(VALID_SAVE);
    expect(m.revalidatePath).toHaveBeenCalledWith('/admin/settings/catalogs/reply-templates');
    expect(m.revalidatePath).toHaveBeenCalledWith('/leader/settings/catalogs/reply-templates');

    m.revalidatePath.mockClear();
    await deleteReplyTemplateAction({ id: 't1' });
    expect(m.deleteReplyTemplate).toHaveBeenCalledWith({}, SESSION, 't1');
    expect(m.revalidatePath).toHaveBeenCalledWith('/admin/settings/catalogs/reply-templates');
    expect(m.revalidatePath).toHaveBeenCalledWith('/leader/settings/catalogs/reply-templates');
  });

  it('отказ сервиса возвращается как есть и страницы не перечитываются', async () => {
    m.saveReplyTemplate.mockResolvedValueOnce({
      ok: false,
      error: 'unknown_placeholder',
      unknown: ['contact.nmae'],
    });
    await expect(saveReplyTemplateAction(VALID_SAVE)).resolves.toEqual({
      ok: false,
      error: 'unknown_placeholder',
      unknown: ['contact.nmae'],
    });
    m.deleteReplyTemplate.mockResolvedValueOnce({ ok: false, error: 'not_found' });
    await expect(deleteReplyTemplateAction({ id: 'чужой' })).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});
