import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const m = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: m.recordAudit }));

import {
  deleteReplyTemplate,
  listReplyTemplates,
  listTemplatesForChannel,
  saveReplyTemplate,
  REPLY_TEMPLATE_TOKENS,
} from '@/lib/services/replyTemplates/crud';

/**
 * Шаблоны быстрых ответов (`У-208`): скоуп компании, закрытый список
 * подстановок и правило «в каком канале предлагать».
 *
 * Отказ сохранить шаблон с опечаткой в подстановке — не придирка: текст
 * «Здравствуйте, {{contact.nmae}}» ушёл бы клиенту прямо с фигурными скобками.
 */
const findMany = vi.fn();
const findFirst = vi.fn();
const create = vi.fn();
const update = vi.fn();
const del = vi.fn();
const prisma = {
  replyTemplate: { findMany, findFirst, create, update, delete: del },
} as unknown as PrismaClient;

const session = { sub: 'me', role: 'leader', companyId: 'c1' } as SessionPayload;

const VALID = {
  id: null,
  title: 'Приветствие',
  body: 'Здравствуйте, {{contact.name}}!',
  channels: ['telegram'],
  isActive: true,
  sortOrder: 10,
};

describe('saveReplyTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    create.mockResolvedValue({ id: 't1' });
    update.mockResolvedValue({});
    findFirst.mockResolvedValue({ id: 't1' });
  });

  it('сессия без компании → forbidden, база не спрашивается', async () => {
    await expect(
      saveReplyTemplate(prisma, { ...session, companyId: null }, VALID)
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
    expect(create).not.toHaveBeenCalled();
  });

  it('пустое название или пустой текст (в том числе из пробелов) → invalid', async () => {
    await expect(saveReplyTemplate(prisma, session, { ...VALID, title: '  ' })).resolves.toEqual({
      ok: false,
      error: 'invalid',
    });
    await expect(saveReplyTemplate(prisma, session, { ...VALID, body: '' })).resolves.toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('слишком длинное название или текст → text_too_long', async () => {
    await expect(
      saveReplyTemplate(prisma, session, { ...VALID, title: 'я'.repeat(121) })
    ).resolves.toEqual({ ok: false, error: 'text_too_long' });
    await expect(
      saveReplyTemplate(prisma, session, { ...VALID, body: 'я'.repeat(4001) })
    ).resolves.toEqual({ ok: false, error: 'text_too_long' });
    expect(create).not.toHaveBeenCalled();
  });

  it('неизвестная подстановка → unknown_placeholder со списком опечаток, шаблон не сохраняется', async () => {
    const r = await saveReplyTemplate(prisma, session, {
      ...VALID,
      body: 'Здравствуйте, {{contact.nmae}}! Ваш заказ {{order.nomer}}.',
    });
    expect(r).toEqual({
      ok: false,
      error: 'unknown_placeholder',
      unknown: ['contact.nmae', 'order.nomer'],
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('все подстановки из списка проходят сохранение', async () => {
    const body = REPLY_TEMPLATE_TOKENS.map((t) => `{{${t.token}}}`).join(' ');
    await expect(saveReplyTemplate(prisma, session, { ...VALID, body })).resolves.toEqual({
      ok: true,
      id: 't1',
    });
  });

  it('канал, которого не существует → invalid (иначе шаблон не предложился бы нигде)', async () => {
    await expect(
      saveReplyTemplate(prisma, session, { ...VALID, channels: ['telegram', 'sms'] })
    ).resolves.toEqual({ ok: false, error: 'invalid' });
    expect(create).not.toHaveBeenCalled();
  });

  it('создание пишет шаблон в свою компанию и аудит reply_template_created', async () => {
    const r = await saveReplyTemplate(prisma, session, { ...VALID, title: '  Приветствие  ' });
    expect(r).toEqual({ ok: true, id: 't1' });
    expect(create).toHaveBeenCalledWith({
      data: {
        companyId: 'c1',
        title: 'Приветствие',
        body: 'Здравствуйте, {{contact.name}}!',
        channels: ['telegram'],
        isActive: true,
        sortOrder: 10,
        updatedById: 'me',
      },
      select: { id: true },
    });
    expect(m.recordAudit).toHaveBeenCalledWith(prisma, {
      action: 'reply_template_created',
      entity: 'reply_template',
      entityId: 't1',
      userId: 'me',
      after: { title: 'Приветствие' },
    });
  });

  it('правка чужого шаблона → not_found, чужая строка не меняется', async () => {
    findFirst.mockResolvedValueOnce(null);
    await expect(saveReplyTemplate(prisma, session, { ...VALID, id: 'чужой' })).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    // Поиск идёт сразу со скоупом компании — чужой шаблон не находится в принципе.
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'чужой', companyId: 'c1' },
      select: { id: true },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('правка своего шаблона пишет аудит другим действием — reply_template_updated', async () => {
    const r = await saveReplyTemplate(prisma, session, { ...VALID, id: 't1', isActive: false });
    expect(r).toEqual({ ok: true, id: 't1' });
    expect(update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: {
        title: 'Приветствие',
        body: 'Здравствуйте, {{contact.name}}!',
        channels: ['telegram'],
        isActive: false,
        sortOrder: 10,
        updatedById: 'me',
      },
    });
    expect(m.recordAudit).toHaveBeenCalledWith(prisma, {
      action: 'reply_template_updated',
      entity: 'reply_template',
      entityId: 't1',
      userId: 'me',
      after: { title: 'Приветствие', isActive: false },
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('listReplyTemplates и listTemplatesForChannel', () => {
  const rows = [
    {
      id: 'any',
      title: 'Любой канал',
      body: 'т',
      channels: [],
      isActive: true,
      sortOrder: 0,
      usageCount: 0,
    },
    {
      id: 'tg',
      title: 'Только телеграм',
      body: 'т',
      channels: ['telegram'],
      isActive: true,
      sortOrder: 1,
      usageCount: 3,
    },
    {
      id: 'mail',
      title: 'Только почта',
      body: 'т',
      channels: ['email'],
      isActive: true,
      sortOrder: 2,
      usageCount: 0,
    },
    {
      id: 'off',
      title: 'Выключенный',
      body: 'т',
      channels: [],
      isActive: false,
      sortOrder: 3,
      usageCount: 0,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue(rows);
  });

  it('сессия без компании → пустой список, база не спрашивается', async () => {
    await expect(listReplyTemplates(prisma, { ...session, companyId: null })).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('список берётся только по своей компании и в устойчивом порядке', async () => {
    await listReplyTemplates(prisma, session);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ companyId: 'c1' });
    expect(arg.orderBy).toEqual([{ sortOrder: 'asc' }, { title: 'asc' }, { id: 'asc' }]);
  });

  it('в канале предлагаются шаблоны «любого канала» и этого канала, выключенные — нет', async () => {
    const forTelegram = await listTemplatesForChannel(prisma, session, 'telegram');
    expect(forTelegram.map((t) => t.id)).toEqual(['any', 'tg']);

    const forEmail = await listTemplatesForChannel(prisma, session, 'email');
    expect(forEmail.map((t) => t.id)).toEqual(['any', 'mail']);
  });
});

describe('deleteReplyTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    del.mockResolvedValue({});
  });

  it('сессия без компании → forbidden', async () => {
    await expect(
      deleteReplyTemplate(prisma, { ...session, companyId: null }, 't1')
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
    expect(del).not.toHaveBeenCalled();
  });

  it('чужой шаблон → not_found, удаления нет', async () => {
    findFirst.mockResolvedValueOnce(null);
    await expect(deleteReplyTemplate(prisma, session, 'чужой')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(del).not.toHaveBeenCalled();
  });

  it('успех удаляет и пишет аудит с названием — по журналу видно, что именно пропало', async () => {
    findFirst.mockResolvedValueOnce({ id: 't1', title: 'Приветствие' });
    await expect(deleteReplyTemplate(prisma, session, 't1')).resolves.toEqual({ ok: true });
    expect(del).toHaveBeenCalledWith({ where: { id: 't1' } });
    expect(m.recordAudit).toHaveBeenCalledWith(prisma, {
      action: 'reply_template_deleted',
      entity: 'reply_template',
      entityId: 't1',
      userId: 'me',
      after: { title: 'Приветствие' },
    });
  });
});
