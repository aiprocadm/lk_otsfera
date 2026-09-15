import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const m = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { warn: m.warn, error: vi.fn(), info: vi.fn() } }));

import { applyReplyTemplate } from '@/lib/services/replyTemplates/apply';

/**
 * Вставка шаблона в форму ответа (`У-208`).
 *
 * Требование к поведению: сотрудник видит ДО отправки, что подставилось не
 * всё. Поэтому проверяем не только готовый текст, но и список пустых
 * подстановок — иначе клиент получит письмо без имени и без номера заказа.
 */
const templateFindFirst = vi.fn();
const templateUpdate = vi.fn();
const dialogFindUnique = vi.fn();
const userFindUnique = vi.fn();
const orderFindFirst = vi.fn();
const prisma = {
  replyTemplate: { findFirst: templateFindFirst, update: templateUpdate },
  messengerDialog: { findUnique: dialogFindUnique },
  user: { findUnique: userFindUnique },
  order: { findFirst: orderFindFirst },
} as unknown as PrismaClient;

const session = { sub: 'me', role: 'manager', companyId: 'c1' } as SessionPayload;

const FULL_DIALOG = {
  id: 'd1',
  companyId: 'c1',
  peerDisplay: 'ivan_tg',
  contact: { name: 'Иван Петров' },
  organization: { id: 'o1', name: 'ООО Ромашка' },
};

const args = { templateId: 't1', dialogId: 'd1' };

describe('applyReplyTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    templateFindFirst.mockResolvedValue({ id: 't1', body: 'Здравствуйте, {{contact.name}}!' });
    templateUpdate.mockResolvedValue({});
    dialogFindUnique.mockResolvedValue(FULL_DIALOG);
    userFindUnique.mockResolvedValue({ name: 'Мария Сидорова' });
    orderFindFirst.mockResolvedValue({ orderNumber: 'ЗК-17' });
  });

  it('сессия без компании → forbidden, база не спрашивается', async () => {
    await expect(
      applyReplyTemplate(prisma, { ...session, companyId: null }, args)
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
    expect(templateFindFirst).not.toHaveBeenCalled();
  });

  it('чужой шаблон → not_found, и ищется он сразу со скоупом компании', async () => {
    templateFindFirst.mockResolvedValueOnce(null);
    await expect(applyReplyTemplate(prisma, session, args)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(templateFindFirst).toHaveBeenCalledWith({
      where: { id: 't1', companyId: 'c1' },
      select: { id: true, body: true },
    });
    expect(templateUpdate).not.toHaveBeenCalled();
  });

  it('чужой или несуществующий диалог → not_found, шаблон не выдаётся', async () => {
    dialogFindUnique.mockResolvedValueOnce({ ...FULL_DIALOG, companyId: 'c2' });
    await expect(applyReplyTemplate(prisma, session, args)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    dialogFindUnique.mockResolvedValueOnce(null);
    await expect(applyReplyTemplate(prisma, session, args)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(templateUpdate).not.toHaveBeenCalled();
  });

  it('подстановки заполняются из контакта, организации, сотрудника и заказа', async () => {
    templateFindFirst.mockResolvedValueOnce({
      id: 't1',
      body: 'Здравствуйте, {{contact.name}} ({{organization.name}})! Заказ {{order.number}}. — {{manager.name}}',
    });
    const r = await applyReplyTemplate(prisma, session, args);
    expect(r).toEqual({
      ok: true,
      text: 'Здравствуйте, Иван Петров (ООО Ромашка)! Заказ ЗК-17. — Мария Сидорова',
      empty: [],
    });
  });

  it('чего нет — то остаётся пустым местом, а не фигурными скобками, и попадает в список empty', async () => {
    templateFindFirst.mockResolvedValueOnce({
      id: 't1',
      body: 'Здравствуйте, {{contact.name}}! Заказ {{order.number}} от {{organization.name}}.',
    });
    dialogFindUnique.mockResolvedValueOnce({
      id: 'd1',
      companyId: 'c1',
      peerDisplay: null,
      contact: null,
      organization: null,
    });
    const r = await applyReplyTemplate(prisma, session, args);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe('Здравствуйте, ! Заказ  от .');
    expect(r.text).not.toContain('{{');
    // Человеку показываем русские названия, а не машинные имена (§15).
    expect(r.empty.sort()).toEqual([
      'Имя контакта',
      'Название организации',
      'Номер последнего заказа в работе',
    ]);
  });

  it('номер заказа ищется только если он есть в тексте — лишнего запроса к базе нет', async () => {
    templateFindFirst.mockResolvedValueOnce({ id: 't1', body: 'Здравствуйте, {{contact.name}}!' });
    await applyReplyTemplate(prisma, session, args);
    expect(orderFindFirst).not.toHaveBeenCalled();
  });

  it('номер берётся у последнего заказа организации в работе', async () => {
    templateFindFirst.mockResolvedValueOnce({ id: 't1', body: 'Заказ {{order.number}}' });
    const r = await applyReplyTemplate(prisma, session, args);
    expect(r).toEqual({ ok: true, text: 'Заказ ЗК-17', empty: [] });
    const where = orderFindFirst.mock.calls[0][0].where;
    expect(where.organizationId).toBe('o1');
    expect(where.executionStatus).toEqual({ in: ['pending', 'in_progress', 'on_hold'] });
  });

  it('диалог без организации: заказ не ищем, номер остаётся пустым и предупреждает', async () => {
    templateFindFirst.mockResolvedValueOnce({ id: 't1', body: 'Заказ {{order.number}}' });
    dialogFindUnique.mockResolvedValueOnce({ ...FULL_DIALOG, organization: null });
    const r = await applyReplyTemplate(prisma, session, args);
    expect(r).toEqual({
      ok: true,
      text: 'Заказ ',
      empty: ['Номер последнего заказа в работе'],
    });
    expect(orderFindFirst).not.toHaveBeenCalled();
  });

  it('имя контакта берётся из контакта, иначе из прозвища диалога', async () => {
    dialogFindUnique.mockResolvedValueOnce({ ...FULL_DIALOG, contact: { name: '   ' } });
    await expect(applyReplyTemplate(prisma, session, args)).resolves.toEqual({
      ok: true,
      text: 'Здравствуйте, ivan_tg!',
      empty: [],
    });
  });

  it('счётчик использований увеличивается на единицу', async () => {
    await applyReplyTemplate(prisma, session, args);
    expect(templateUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { usageCount: { increment: 1 } },
    });
  });

  it('заказ найден, но без номера — подстановка пустая, а не «undefined»', async () => {
    // У заказа из внешней системы номер может быть не заполнен: подставлять
    // туда «undefined» клиенту нельзя.
    templateFindFirst.mockResolvedValueOnce({ id: 't1', body: 'Заказ {{order.number}}' });
    orderFindFirst.mockResolvedValueOnce({ orderNumber: null });
    const r = await applyReplyTemplate(prisma, session, args);
    expect(r).toEqual({
      ok: true,
      text: 'Заказ ',
      empty: ['Номер последнего заказа в работе'],
    });
  });

  it('сбой счётчика не-ошибкой (строкой) тоже не роняет вставку', async () => {
    templateUpdate.mockRejectedValueOnce('внезапно строка');
    await expect(applyReplyTemplate(prisma, session, args)).resolves.toMatchObject({ ok: true });
    expect(m.warn).toHaveBeenCalledWith(
      expect.stringContaining('usage counter failed'),
      expect.objectContaining({ error: 'внезапно строка' })
    );
  });

  it('сбой счётчика не роняет вставку — ответить клиенту важнее статистики', async () => {
    templateUpdate.mockRejectedValueOnce(new Error('база недоступна'));
    await expect(applyReplyTemplate(prisma, session, args)).resolves.toEqual({
      ok: true,
      text: 'Здравствуйте, Иван Петров!',
      empty: [],
    });
    expect(m.warn).toHaveBeenCalled();
  });

  it('подстановка вне списка тоже становится пустым местом, а не скобками', async () => {
    // Сохранить такой шаблон нельзя (`unknown_placeholder`), но строка может
    // прийти из сида или пережить сужение списка подстановок. Скобки в тексте
    // ушли бы клиенту как есть, поэтому пустым становится ЛЮБОЙ токен из
    // текста, а не только известный.
    templateFindFirst.mockResolvedValueOnce({ id: 't1', body: 'Мой телефон {{manager.phone}}' });
    const r = await applyReplyTemplate(prisma, session, args);
    expect(r).toEqual({ ok: true, text: 'Мой телефон ', empty: ['manager.phone'] });
  });

  it('имя сотрудника читается только при наличии {{manager.name}} в тексте', async () => {
    // Симметрично номеру заказа: лишний запрос к базе на каждую вставку не нужен.
    templateFindFirst.mockResolvedValueOnce({ id: 't1', body: 'Добрый день!' });
    await applyReplyTemplate(prisma, session, args);
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it('имя сотрудника читается, когда подстановка в тексте есть', async () => {
    templateFindFirst.mockResolvedValueOnce({ id: 't1', body: 'С уважением, {{manager.name}}' });
    await applyReplyTemplate(prisma, session, args);
    expect(userFindUnique).toHaveBeenCalledWith({ where: { id: 'me' }, select: { name: true } });
  });
});
