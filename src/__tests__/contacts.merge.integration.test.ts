import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { mergeContacts } from '@/lib/services/contacts/merge';

/**
 * Объединение дублей на живом Postgres (этап 1 ТЗ 12.09.2026, `У-181`, спека
 * §3.5): все связи второго контакта — каналы, входящее письмо, звонок, диалог
 * мессенджера, заказ, сделка, пользователь кабинета — переезжают к главному
 * одной транзакцией; второй уходит в архив со ссылкой `mergedIntoId`; пустые
 * поля главного заполняются из второго; повторное объединение с уже
 * объединённым — отказ. Партнёр и чужая компания получают `not_found`.
 */
const prisma = new PrismaClient();
const STAMP = `mrg${Date.now()}`;

let companyId: string;
let otherCompanyId: string;
let orgId: string;
let managerId: string;
let cabinetUserId: string;
let primaryId: string;
let secondaryId: string;
let foreignId: string;

const manager = (): SessionPayload =>
  ({
    sub: managerId,
    role: 'manager',
    companyId,
    managedOrgIds: [orgId],
  }) as unknown as SessionPayload;

beforeAll(async () => {
  const co = await prisma.company.create({
    data: { name: `${STAMP}-co`, managerTeamVisibility: true },
  });
  companyId = co.id;
  const other = await prisma.company.create({ data: { name: `${STAMP}-other` } });
  otherCompanyId = other.id;
  const org = await prisma.organization.create({ data: { name: `${STAMP}-org`, companyId } });
  orgId = org.id;
  const mgr = await prisma.user.create({
    data: { email: `${STAMP}-m@t.test`, name: `${STAMP}-mgr`, role: 'manager', companyId },
  });
  managerId = mgr.id;
  const cabinetUser = await prisma.user.create({
    data: {
      email: `${STAMP}-cab@t.test`,
      name: `${STAMP}-cab`,
      role: 'organization',
      organizationId: orgId,
    },
  });
  cabinetUserId = cabinetUser.id;

  const primary = await prisma.contact.create({
    data: {
      companyId,
      organizationId: null,
      name: `${STAMP}-Иванов`,
      channels: {
        create: [
          {
            companyId,
            type: 'phone',
            value: '+7 921 000-00-01',
            normalizedValue: '+79210000001',
            isPrimary: true,
          },
        ],
      },
    },
  });
  primaryId = primary.id;
  const secondary = await prisma.contact.create({
    data: {
      companyId,
      organizationId: orgId,
      userId: cabinetUserId,
      name: `${STAMP}-Иванов И.`,
      position: 'директор',
      note: 'звонить после 14:00',
      channels: {
        create: [
          {
            companyId,
            type: 'email',
            value: `${STAMP}@t.test`,
            normalizedValue: `${STAMP.toLowerCase()}@t.test`,
            isPrimary: true,
          },
          { companyId, type: 'telegram', value: `${STAMP}-tg`, normalizedValue: `${STAMP}-tg` },
        ],
      },
    },
  });
  secondaryId = secondary.id;
  const foreign = await prisma.contact.create({
    data: { companyId: otherCompanyId, name: `${STAMP}-Чужой` },
  });
  foreignId = foreign.id;

  await prisma.inboundMessage.create({
    data: {
      channel: 'telegram',
      externalId: `${STAMP}:in`,
      senderRef: `${STAMP}-tg`,
      body: 'привет',
      companyId,
      status: 'bound',
      contactId: secondaryId,
    },
  });
  await prisma.call.create({
    data: {
      provider: 'mango',
      externalId: `${STAMP}:call`,
      direction: 'inbound',
      callerNumber: '+79210000002',
      status: 'completed',
      companyId,
      contactId: secondaryId,
    },
  });
  await prisma.messengerDialog.create({
    data: { channel: 'telegram', peerRef: `${STAMP}-peer`, companyId, contactId: secondaryId },
  });
  await prisma.order.create({
    data: {
      title: `${STAMP}-order`,
      companyId,
      organizationId: orgId,
      totalAmount: 1000,
      primaryContactId: secondaryId,
    },
  });
  await prisma.deal.create({
    data: { title: `${STAMP}-deal`, companyId, managerId, status: 'open', contactId: secondaryId },
  });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: managerId } });
  await prisma.piiAccessEvent.deleteMany({ where: { userId: managerId } });
  await prisma.deal.deleteMany({ where: { companyId } });
  await prisma.order.deleteMany({ where: { companyId } });
  await prisma.messengerDialog.deleteMany({ where: { companyId } });
  await prisma.call.deleteMany({ where: { companyId } });
  await prisma.inboundMessage.deleteMany({ where: { companyId } });
  await prisma.contactChannel.deleteMany({
    where: { companyId: { in: [companyId, otherCompanyId] } },
  });
  await prisma.contact.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [managerId, cabinetUserId] } } });
  await prisma.organization.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  await prisma.$disconnect();
});

describe('mergeContacts (У-181)', () => {
  it('чужая компания и партнёр → not_found; сам с собой → contact_merge_self', async () => {
    expect(
      await mergeContacts(prisma, manager(), true, { primaryId, secondaryId: foreignId })
    ).toEqual({
      ok: false,
      error: 'not_found',
    });
    const partner = {
      sub: 'p',
      role: 'partner',
      companyId,
      partnerId: 'x',
    } as unknown as SessionPayload;
    expect(await mergeContacts(prisma, partner, false, { primaryId, secondaryId })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(
      await mergeContacts(prisma, manager(), true, { primaryId, secondaryId: primaryId })
    ).toEqual({
      ok: false,
      error: 'contact_merge_self',
    });
  });

  it('переносит все связи одной транзакцией, архивирует второго и заполняет пустые поля главного', async () => {
    const res = await mergeContacts(prisma, manager(), true, { primaryId, secondaryId });
    expect(res).toEqual({
      ok: true,
      primaryId,
      moved: {
        channels: 2,
        inbound: 1,
        calls: 1,
        dialogs: 1,
        orders: 1,
        deals: 1,
        userMoved: true,
      },
    });

    const primary = await prisma.contact.findUniqueOrThrow({
      where: { id: primaryId },
      include: { channels: { orderBy: { createdAt: 'asc' } } },
    });
    expect(primary.channels.map((c) => c.type)).toEqual(['phone', 'email', 'telegram']);
    // Основной остаётся у главного, перенесённые — не основные.
    expect(primary.channels.filter((c) => c.isPrimary).map((c) => c.type)).toEqual(['phone']);
    expect(primary.userId).toBe(cabinetUserId);
    expect(primary.position).toBe('директор');
    expect(primary.note).toBe('звонить после 14:00');
    expect(primary.organizationId).toBe(orgId);

    const secondary = await prisma.contact.findUniqueOrThrow({ where: { id: secondaryId } });
    expect(secondary.isArchived).toBe(true);
    expect(secondary.mergedIntoId).toBe(primaryId);
    expect(secondary.userId).toBeNull();

    expect(await prisma.inboundMessage.count({ where: { contactId: primaryId } })).toBe(1);
    expect(await prisma.call.count({ where: { contactId: primaryId } })).toBe(1);
    expect(await prisma.messengerDialog.count({ where: { contactId: primaryId } })).toBe(1);
    expect(await prisma.order.count({ where: { primaryContactId: primaryId } })).toBe(1);
    expect(await prisma.deal.count({ where: { contactId: primaryId } })).toBe(1);
    expect(await prisma.contactChannel.count({ where: { contactId: secondaryId } })).toBe(0);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'contact_merged', entityId: primaryId },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect((audit!.meta as { before: { channels: number } }).before.channels).toBe(2);
  });

  it('главный после объединения держит все связи; второй помнит главного', async () => {
    const primary = await prisma.contact.findUniqueOrThrow({
      where: { id: primaryId },
      select: {
        userId: true,
        _count: {
          select: {
            messengerDialogs: true,
            calls: true,
            inboundMessages: true,
            ordersAsPrimary: true,
          },
        },
      },
    });
    expect(primary._count).toEqual({
      messengerDialogs: 1,
      calls: 1,
      inboundMessages: 1,
      ordersAsPrimary: 1,
    });
    expect(await prisma.deal.count({ where: { contactId: primaryId } })).toBe(1);
    expect(primary.userId).toBe(cabinetUserId);
    const archived = await prisma.contact.findUniqueOrThrow({ where: { id: secondaryId } });
    expect(archived.mergedIntoId).toBe(primaryId);
  });

  it('уже объединённый контакт не годится в главные', async () => {
    const third = await prisma.contact.create({ data: { companyId, name: `${STAMP}-Третий` } });
    expect(
      await mergeContacts(prisma, manager(), true, {
        primaryId: secondaryId,
        secondaryId: third.id,
      })
    ).toEqual({
      ok: false,
      error: 'contact_merge_target_merged',
    });
  });

  it('два пользователя кабинета не объединяются', async () => {
    const otherUser = await prisma.user.create({
      data: {
        email: `${STAMP}-cab2@t.test`,
        name: `${STAMP}-cab2`,
        role: 'organization',
        organizationId: orgId,
      },
    });
    const withUser = await prisma.contact.create({
      data: { companyId, name: `${STAMP}-Второй пользователь`, userId: otherUser.id },
    });
    expect(
      await mergeContacts(prisma, manager(), true, { primaryId, secondaryId: withUser.id })
    ).toEqual({
      ok: false,
      error: 'contact_merge_two_users',
    });
    await prisma.contact.delete({ where: { id: withUser.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });
});
