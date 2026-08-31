/**
 * Этап 6 (`У-160`) — серверные действия раздела «Шаблоны текстов договора».
 *
 * Проверяем ровно то, за что отвечает адаптер, а не сервис: сессию берём с
 * сервера (а не из формы), поля формы приводим к строкам, и обновляем кэш
 * страницы ТОЛЬКО при успехе — иначе экран после отказа показал бы вид, будто
 * что-то сохранилось. Права и границы компании проверяются в
 * services.documents.templates.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSettingsSection, revalidatePath, saveCompanyTemplate, resetCompanyTemplate } =
  vi.hoisted(() => ({
    requireSettingsSection: vi.fn(),
    revalidatePath: vi.fn(),
    saveCompanyTemplate: vi.fn(),
    resetCompanyTemplate: vi.fn(),
  }));

vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/services/documents/templates', () => ({
  saveCompanyTemplate,
  resetCompanyTemplate,
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { prisma } from '@/lib/db/prisma';
import {
  resetDocumentTemplateAction,
  saveDocumentTemplateAction,
} from '@/server-actions/documents/documentTemplates';

const ADMIN = { sub: 'a1', role: 'admin', companyId: 'co-A' };
const LEADER = { sub: 'l1', role: 'leader', companyId: 'co-A' };

const PATH_ADMIN = '/admin/settings/catalogs/document-templates';
const PATH_LEADER = '/leader/settings/catalogs/document-templates';

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSettingsSection.mockResolvedValue(ADMIN);
  saveCompanyTemplate.mockResolvedValue({ ok: true, revision: 7 });
  resetCompanyTemplate.mockResolvedValue({ ok: true });
});

describe('saveDocumentTemplateAction', () => {
  it('сессию берёт сервер: подделанные поля роли и пользователя в форме игнорируются', async () => {
    await saveDocumentTemplateAction(
      'admin',
      form({
        companyId: 'co-A',
        slot: 'payment',
        body: 'Оплата в течение 5 дней.',
        // Подкидываем «свою» роль и «своего» пользователя — адаптер обязан их не заметить.
        role: 'admin',
        sub: 'кто-то-другой',
      })
    );
    expect(requireSettingsSection).toHaveBeenCalledTimes(1);
    expect(saveCompanyTemplate).toHaveBeenCalledWith(prisma, ADMIN, {
      companyId: 'co-A',
      slot: 'payment',
      body: 'Оплата в течение 5 дней.',
    });
  });

  it('успех у администратора обновляет кэш раздела в ЕГО кабинете', async () => {
    const res = await saveDocumentTemplateAction(
      'admin',
      form({ companyId: 'co-B', slot: 'subject.contract', body: 'Текст.' })
    );
    expect(res).toEqual({ ok: true, revision: 7 });
    expect(revalidatePath).toHaveBeenCalledWith(PATH_ADMIN);
  });

  it('в кабинете руководителя обновляется адрес /leader, а не /admin', async () => {
    // Кабинет приходит от страницы и им же гардится: подделать его нельзя —
    // requireSettingsSection сверит кабинет с ролью сессии.
    requireSettingsSection.mockResolvedValue(LEADER);
    await saveDocumentTemplateAction(
      'leader',
      form({ companyId: 'co-A', slot: 'misc', body: 'Текст.' })
    );
    expect(revalidatePath).toHaveBeenCalledWith(PATH_LEADER);
    expect(revalidatePath).not.toHaveBeenCalledWith(PATH_ADMIN);
  });

  it('пустая форма не роняет действие: сервис получает пустые строки и сам отвечает отказом', async () => {
    // Форма без полей приходит, например, из старой вкладки; падение с 500
    // здесь было бы хуже понятного «неизвестный абзац».
    saveCompanyTemplate.mockResolvedValue({ ok: false, error: 'unknown_slot' });
    const res = await saveDocumentTemplateAction('admin', new FormData());
    expect(res).toEqual({ ok: false, error: 'unknown_slot' });
    expect(saveCompanyTemplate).toHaveBeenCalledWith(prisma, ADMIN, {
      companyId: '',
      slot: '',
      body: '',
    });
  });

  it('файл вместо текста тоже превращается в пустую строку, а не уезжает в сервис объектом', async () => {
    // `FormData.get` возвращает File, если поле подсунули файлом; в сервис
    // должен уйти строковый контракт, иначе там сломается `body.trim()`.
    const fd = new FormData();
    fd.set('companyId', 'co-A');
    fd.set('slot', 'payment');
    fd.set('body', new File(['вредный файл'], 'body.txt', { type: 'text/plain' }));
    saveCompanyTemplate.mockResolvedValue({ ok: false, error: 'text_empty' });
    expect(await saveDocumentTemplateAction('admin', fd)).toEqual({
      ok: false,
      error: 'text_empty',
    });
    expect(saveCompanyTemplate).toHaveBeenCalledWith(prisma, ADMIN, {
      companyId: 'co-A',
      slot: 'payment',
      body: '',
    });
  });

  it('отказ прав отдаётся как есть и кэш не трогается', async () => {
    saveCompanyTemplate.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(
      await saveDocumentTemplateAction(
        'admin',
        form({ companyId: 'чужая', slot: 'payment', body: 'Текст.' })
      )
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('ошибка подстановок доезжает вместе со списком токенов — экрану есть что показать', async () => {
    // Без `tokens` человек увидел бы «что-то не так» и не понял, какую скобку убрать.
    saveCompanyTemplate.mockResolvedValue({
      ok: false,
      error: 'unknown_placeholder',
      tokens: ['{{ клиент.выдумка }}'],
    });
    const res = await saveDocumentTemplateAction(
      'admin',
      form({ companyId: 'co-A', slot: 'payment', body: '{{ клиент.выдумка }}' })
    );
    expect(res).toEqual({
      ok: false,
      error: 'unknown_placeholder',
      tokens: ['{{ клиент.выдумка }}'],
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('resetDocumentTemplateAction', () => {
  it('в сервис уходят только компания и абзац из формы плюс серверная сессия', async () => {
    // Текст сюда не передаётся намеренно: сброс — это удаление своей строки.
    const res = await resetDocumentTemplateAction(
      'admin',
      form({ companyId: 'co-A', slot: 'liability', body: 'лишнее поле' })
    );
    expect(res).toEqual({ ok: true });
    expect(requireSettingsSection).toHaveBeenCalledTimes(1);
    expect(resetCompanyTemplate).toHaveBeenCalledWith(prisma, ADMIN, {
      companyId: 'co-A',
      slot: 'liability',
    });
    expect(revalidatePath).toHaveBeenCalledWith(PATH_ADMIN);
  });

  it('у руководителя обновляется его собственный адрес раздела', async () => {
    requireSettingsSection.mockResolvedValue(LEADER);
    await resetDocumentTemplateAction('leader', form({ companyId: 'co-A', slot: 'deadline' }));
    expect(revalidatePath).toHaveBeenCalledWith(PATH_LEADER);
  });

  it('пустая форма доходит до сервиса пустыми строками и не роняет действие', async () => {
    resetCompanyTemplate.mockResolvedValue({ ok: false, error: 'unknown_slot' });
    expect(await resetDocumentTemplateAction('admin', new FormData())).toEqual({
      ok: false,
      error: 'unknown_slot',
    });
    expect(resetCompanyTemplate).toHaveBeenCalledWith(prisma, ADMIN, { companyId: '', slot: '' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('отказ прав прокидывается как есть, кэш не обновляется', async () => {
    resetCompanyTemplate.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(
      await resetDocumentTemplateAction(
        'admin',
        form({ companyId: 'чужая', slot: 'term.contract' })
      )
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
