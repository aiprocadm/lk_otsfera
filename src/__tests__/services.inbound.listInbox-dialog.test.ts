import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import { listInbox } from '@/lib/services/inbound/listInbox';

/**
 * Связь «Входящих» и диалога (`У-215`).
 *
 * Одно и то же письмо живёт в двух местах: в разборе «Входящих» и репликой в
 * диалоге. До этапа 3 перейти из одного в другое было нельзя — человек искал
 * письмо глазами. Теперь в строке есть `dialogId` («открыть диалог»), а в
 * фильтрах — `messageId` («открыть во Входящих» из ленты диалога).
 */
const findMany = vi.fn();
const count = vi.fn();
const prisma = { inboundMessage: { findMany, count } } as unknown as PrismaClient;
const session = { sub: 'm1', role: 'manager', companyId: 'c1' } as SessionPayload;

/** Скоуп «Входящих»: своя компания + общая очередь неразобранных. */
const SCOPE = { OR: [{ companyId: 'c1' }, { status: 'unresolved' }] };

const row = {
  id: 'i1',
  channel: 'email',
  senderRef: 'client@t.test',
  senderDisplay: 'Клиент',
  subject: 'Вопрос',
  body: 'текст',
  createdAt: new Date('2026-09-14T08:00:00Z'),
  status: 'bound',
  resolvedOrgId: 'o1',
  scanStatus: 'clean',
  attachmentName: null,
  dialogMessage: { dialogId: 'd1' },
};

describe('listInbox — переход в диалог и обратно (У-215)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([row]);
    count.mockResolvedValue(1);
  });

  it('строка несёт dialogId — из «Входящих» видно, куда перейти', async () => {
    const r = await listInbox(prisma, session);
    expect(r.items[0]).toMatchObject({ id: 'i1', dialogId: 'd1' });
    // Связь разворачивается в плоское поле: списку незачем знать, что она
    // называется `dialogMessage` и что она односторонняя.
    expect(r.items[0]).not.toHaveProperty('dialogMessage');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ dialogMessage: { select: { dialogId: true } } }),
      })
    );
  });

  it('письмо без диалога → dialogId = null, а не «пусто» и не падение', async () => {
    // Так бывает у старых писем (до мессенджеров) и у каналов, диалогов у
    // которых нет вовсе. Ссылка просто не показывается.
    findMany.mockResolvedValue([
      { ...row, id: 'i2', dialogMessage: null },
      { ...row, id: 'i3', dialogMessage: undefined },
    ]);
    const r = await listInbox(prisma, session);
    expect(r.items.map((i) => i.dialogId)).toEqual([null, null]);
  });

  it('фильтр messageId показывает одно письмо, но скоуп остаётся поверх', async () => {
    await listInbox(prisma, session, { messageId: 'i1' });
    // Чужое письмо по прямой ссылке не откроется: условие компании стоит
    // рядом, а не вместо. Список просто окажется пустым.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [SCOPE, { id: 'i1' }] } })
    );
    expect(count).toHaveBeenCalledWith({ where: { AND: [SCOPE, { id: 'i1' }] } });
  });

  it('messageId уживается с остальными фильтрами', async () => {
    await listInbox(prisma, session, {
      messageId: 'i1',
      channel: 'email',
      status: 'bound',
      orgId: 'o1',
    });
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          AND: [SCOPE, { channel: 'email', status: 'bound', resolvedOrgId: 'o1', id: 'i1' }],
        },
      })
    );
  });

  it('без messageId лишнего условия по id не появляется', async () => {
    await listInbox(prisma, session);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [SCOPE, {}] } }));
    // И журнал ПДн пишется по письмам, а не по диалогам.
    expect(recordPiiAccess).toHaveBeenCalledWith(prisma, {
      session,
      context: 'inbox_list',
      subjectIds: ['i1'],
    });
  });

  it('сессия без компании видит только неразобранную очередь', async () => {
    await listInbox(prisma, { ...session, companyId: null } as SessionPayload, { messageId: 'i1' });
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ OR: [{ companyId: '__no_company__' }, { status: 'unresolved' }] }, { id: 'i1' }],
        },
      })
    );
  });
});
