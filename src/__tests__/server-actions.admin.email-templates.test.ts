import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Свои тексты писем (`У-128`).
 *
 * Главное, что здесь проверяется, — **область правки задаёт роль, а не форма**:
 * администратор правит платформу (`companyId = null`), руководитель — только
 * свою компанию, а сессия без компании получает отказ, а не тихое повышение
 * прав до платформы.
 */
const {
  requireSettingsSection,
  isEmailTemplateKey,
  renderTemplateText,
  validateTemplateText,
  checkTemplateLength,
  sendNotificationEmail,
  recordAudit,
  revalidatePath,
  logError,
  REGISTRY,
  findFirst,
  update,
  create,
  deleteMany,
} = vi.hoisted(() => ({
  requireSettingsSection: vi.fn(),
  isEmailTemplateKey: vi.fn(),
  renderTemplateText: vi.fn(),
  validateTemplateText: vi.fn(),
  checkTemplateLength: vi.fn(),
  sendNotificationEmail: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
  logError: vi.fn(),
  REGISTRY: {} as Record<string, { placeholders: Array<{ prop: string }> }>,
  findFirst: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));
vi.mock('@/lib/email/templateRegistry', () => ({
  EMAIL_TEMPLATE_REGISTRY: REGISTRY,
  isEmailTemplateKey,
  renderTemplateText,
  validateTemplateText,
  checkTemplateLength,
}));
vi.mock('@/lib/email/send', () => ({ sendNotificationEmail }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/logging', () => ({ log: { error: logError } }));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    notificationTemplate: { findFirst, update, create, deleteMany },
  },
}));

import {
  previewTemplateAction,
  saveTemplateAction,
  resetTemplateAction,
  sendTestTemplateAction,
} from '@/server-actions/admin/emailTemplates';

const KEY = 'order_status_changed';

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(REGISTRY)) delete REGISTRY[k];
  // Одна известная подстановка и одна, которой нет в образцах, — вторая
  // должна превратиться в прочерк, а не в «undefined» в письме.
  REGISTRY[KEY] = { placeholders: [{ prop: 'orderNumber' }, { prop: 'чегоНетВОбразцах' }] };
  isEmailTemplateKey.mockReturnValue(true);
  validateTemplateText.mockReturnValue({ ok: true });
  checkTemplateLength.mockReturnValue({ ok: true });
  renderTemplateText.mockImplementation((_k: string, text: string) => `<${text}>`);
  requireSettingsSection.mockResolvedValue({ sub: 'u1', email: 'a@x.ru', companyId: 'c1' });
  findFirst.mockResolvedValue(null);
});

describe('previewTemplateAction — предпросмотр тем же кодом, что и отправка', () => {
  it('неизвестный ключ шаблона — отказ', async () => {
    isEmailTemplateKey.mockReturnValue(false);

    await expect(previewTemplateAction('admin', 'нет', 'т', 'б')).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('чужая подстановка — отказ со списком, а не дыра в письме', async () => {
    validateTemplateText.mockReturnValue({ ok: false, unknown: ['{{цена}}'] });

    await expect(previewTemplateAction('admin', KEY, 'т', 'б')).resolves.toEqual({
      ok: false,
      error: 'unknown_placeholder',
      unknown: ['{{цена}}'],
    });
  });

  it('успех подставляет образцы; неизвестный образец даёт прочерк', async () => {
    const res = await previewTemplateAction('admin', KEY, 'тема', 'текст');

    expect(res).toEqual({ ok: true, subject: '<тема>', body: '<текст>' });
    expect(renderTemplateText).toHaveBeenCalledWith(KEY, 'тема', {
      orderNumber: 'З-2026-001',
      чегоНетВОбразцах: '—',
    });
  });

  it('ключ есть, а описания нет — подстановок просто нет', async () => {
    delete REGISTRY[KEY];

    const res = await previewTemplateAction('admin', KEY, 'тема', 'текст');

    expect(res).toMatchObject({ ok: true });
    expect(renderTemplateText).toHaveBeenCalledWith(KEY, 'тема', {});
  });
});

describe('saveTemplateAction — сохранение своего текста', () => {
  it('неизвестный ключ — отказ', async () => {
    isEmailTemplateKey.mockReturnValue(false);

    await expect(saveTemplateAction('admin', 'нет', 'т', 'б')).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('пустые тема и текст означают «вернуть стандартный», а не «письмо без темы»', async () => {
    const res = await saveTemplateAction('admin', KEY, '   ', '');

    expect(res).toEqual({ ok: true });
    expect(deleteMany).toHaveBeenCalledWith({ where: { companyId: null, templateKey: KEY } });
    expect(create).not.toHaveBeenCalled();
  });

  it('пустая половина — отказ', async () => {
    await expect(saveTemplateAction('admin', KEY, 'тема', '  ')).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('слишком длинный текст — отказ с полем и пределом', async () => {
    checkTemplateLength.mockReturnValue({ ok: false, field: 'body', max: 5000 });

    await expect(saveTemplateAction('admin', KEY, 'тема', 'текст')).resolves.toEqual({
      ok: false,
      error: 'text_too_long',
      limit: { field: 'body', max: 5000 },
    });
  });

  it('чужая подстановка — отказ сохранить', async () => {
    validateTemplateText.mockReturnValue({ ok: false, unknown: ['{{x}}'] });

    await expect(saveTemplateAction('admin', KEY, 'тема', 'текст')).resolves.toEqual({
      ok: false,
      error: 'unknown_placeholder',
      unknown: ['{{x}}'],
    });
  });

  it('руководитель без компании получает отказ, а не правит платформу', async () => {
    requireSettingsSection.mockResolvedValue({ sub: 'u1', email: 'a@x.ru', companyId: null });

    await expect(saveTemplateAction('leader', KEY, 'тема', 'текст')).resolves.toEqual({
      ok: false,
      error: 'company_required',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('первого текста ещё не было — создаём; область берётся из роли', async () => {
    const res = await saveTemplateAction('leader', KEY, 'тема', 'текст');

    expect(res).toEqual({ ok: true });
    expect(create).toHaveBeenCalledWith({
      data: {
        companyId: 'c1',
        templateKey: KEY,
        subject: 'тема',
        body: 'текст',
        updatedBy: 'u1',
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'email_template_changed', after: { companyId: 'c1' } })
    );
    expect(revalidatePath).toHaveBeenCalledWith('/leader/settings/catalogs/email-templates');
  });

  it('текст уже был — обновляем найденную строку, а не ищем по составному ключу', async () => {
    findFirst.mockResolvedValue({ id: 'row-1' });

    await saveTemplateAction('admin', KEY, 'тема', 'текст');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { subject: 'тема', body: 'текст', updatedBy: 'u1' },
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('resetTemplateAction — «вернуть стандартный» удаляет свой текст', () => {
  it('неизвестный ключ — отказ', async () => {
    isEmailTemplateKey.mockReturnValue(false);

    await expect(resetTemplateAction('admin', 'нет')).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('без компании — отказ', async () => {
    requireSettingsSection.mockResolvedValue({ sub: 'u1', email: 'a@x.ru', companyId: null });

    await expect(resetTemplateAction('leader', KEY)).resolves.toEqual({
      ok: false,
      error: 'company_required',
    });
  });

  it('удаляет строку, пишет журнал и освежает страницу', async () => {
    const res = await resetTemplateAction('admin', KEY);

    expect(res).toEqual({ ok: true });
    expect(deleteMany).toHaveBeenCalledWith({ where: { companyId: null, templateKey: KEY } });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'email_template_reset' })
    );
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings/catalogs/email-templates');
  });
});

describe('sendTestTemplateAction — пробное письмо себе и только себе', () => {
  it('неизвестный ключ — отказ', async () => {
    isEmailTemplateKey.mockReturnValue(false);

    await expect(sendTestTemplateAction('admin', 'нет', 'т', 'б')).resolves.toEqual({
      ok: false,
      error: 'send_failed',
    });
  });

  it('чужая подстановка — отказ', async () => {
    validateTemplateText.mockReturnValue({ ok: false, unknown: ['{{x}}'] });

    await expect(sendTestTemplateAction('admin', KEY, 'т', 'б')).resolves.toEqual({
      ok: false,
      error: 'send_failed',
    });
  });

  it('в сессии нет адреса — честно «не отправлено», а не вид отправки', async () => {
    requireSettingsSection.mockResolvedValue({ sub: 'u1', email: '  ', companyId: 'c1' });

    await expect(sendTestTemplateAction('admin', KEY, 'т', 'б')).resolves.toEqual({
      ok: true,
      skipped: true,
    });
    expect(sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('уходит на адрес из сессии с пометкой «проверка»', async () => {
    sendNotificationEmail.mockResolvedValue({ status: 'sent' });

    const res = await sendTestTemplateAction('admin', KEY, 'тема', 'текст');

    expect(res).toEqual({ ok: true, skipped: false });
    expect(sendNotificationEmail).toHaveBeenCalledWith({
      to: 'a@x.ru',
      recipientName: 'коллега',
      title: '[проверка] <тема>',
      body: '<текст>',
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'email_template_test_sent' })
    );
  });

  it('транспорт письмо не взял — говорим «не отправлено»', async () => {
    sendNotificationEmail.mockResolvedValue({ status: 'skipped' });

    await expect(sendTestTemplateAction('admin', KEY, 'т', 'б')).resolves.toEqual({
      ok: true,
      skipped: true,
    });
  });

  it('сбой отправки логируется и превращается в понятный отказ', async () => {
    sendNotificationEmail.mockRejectedValue(new Error('SMTP лёг'));

    await expect(sendTestTemplateAction('admin', KEY, 'т', 'б')).resolves.toEqual({
      ok: false,
      error: 'send_failed',
    });
    expect(logError).toHaveBeenCalledWith(
      '[email-templates] пробное письмо не ушло',
      expect.objectContaining({ template: KEY, error: 'SMTP лёг' })
    );
  });

  it('не-ошибка в отказе тоже попадает в журнал строкой', async () => {
    sendNotificationEmail.mockRejectedValue('строка вместо ошибки');

    await sendTestTemplateAction('admin', KEY, 'т', 'б');

    expect(logError).toHaveBeenCalledWith(
      '[email-templates] пробное письмо не ушло',
      expect.objectContaining({ error: 'строка вместо ошибки' })
    );
  });
});
