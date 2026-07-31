/**
 * Integration: services/max/link (D3). Живой Postgres; isMaxEnabled замокан
 * (не зависим от env-кредов). Зеркало services.telegram.link.test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const { isMaxEnabled } = vi.hoisted(() => ({ isMaxEnabled: vi.fn() }));
vi.mock('@/lib/max/client', () => ({
  isMaxEnabled,
  maxDeepLink: (code: string) => `https://max.ru/lk_max_bot?start=${code}`,
}));

import {
  generateMaxLinkCode,
  getMaxStatus,
  linkMaxByCode,
  unlinkMax,
} from '@/lib/services/max/link';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = new PrismaClient();
const STAMP = Date.now();
const ids: Record<string, string> = {};

function session(sub: string): SessionPayload {
  return { sub } as SessionPayload;
}

beforeAll(async () => {
  const u1 = await prisma.user.create({
    data: { email: `max-link-a-${STAMP}@test.ru`, name: 'MaxA', role: 'organization' },
  });
  const u2 = await prisma.user.create({
    data: { email: `max-link-b-${STAMP}@test.ru`, name: 'MaxB', role: 'organization' },
  });
  ids.u1 = u1.id;
  ids.u2 = u2.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: { in: [ids.u1, ids.u2] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.u1, ids.u2] } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  isMaxEnabled.mockReturnValue(true);
});

describe('getMaxStatus', () => {
  it('linked отражает наличие maxChatId; enabled из isMaxEnabled', async () => {
    const before = await getMaxStatus(prisma, session(ids.u1));
    expect(before).toEqual({ ok: true, linked: false, enabled: true });

    await prisma.user.update({ where: { id: ids.u1 }, data: { maxChatId: `mc-${STAMP}` } });
    const after = await getMaxStatus(prisma, session(ids.u1));
    expect(after.linked).toBe(true);

    await prisma.user.update({ where: { id: ids.u1 }, data: { maxChatId: null } });
  });
});

describe('generateMaxLinkCode', () => {
  it('max_disabled когда канал выключен', async () => {
    isMaxEnabled.mockReturnValue(false);
    const result = await generateMaxLinkCode(prisma, session(ids.u1));
    expect(result).toEqual({ ok: false, error: 'max_disabled' });
  });

  it('пишет код + expiry, возвращает deep-link', async () => {
    const result = await generateMaxLinkCode(prisma, session(ids.u1));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deepLink).toContain('?start=');
    const u = await prisma.user.findUnique({
      where: { id: ids.u1 },
      select: { maxLinkCode: true, maxLinkCodeExpiresAt: true },
    });
    expect(u?.maxLinkCode).toBeTruthy();
    expect(u?.maxLinkCodeExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('linkMaxByCode', () => {
  it('invalid_code для несуществующего кода', async () => {
    const result = await linkMaxByCode(prisma, { code: 'nope', chatId: 'c1' });
    expect(result).toEqual({ ok: false, error: 'invalid_code' });
  });

  it('успех: пишет maxChatId, чистит код, audit', async () => {
    await generateMaxLinkCode(prisma, session(ids.u1));
    const u = await prisma.user.findUnique({
      where: { id: ids.u1 },
      select: { maxLinkCode: true },
    });
    const chatId = `mc-linked-${STAMP}`;
    const result = await linkMaxByCode(prisma, { code: u!.maxLinkCode!, chatId });
    expect(result).toEqual({ ok: true });
    const after = await prisma.user.findUnique({
      where: { id: ids.u1 },
      select: { maxChatId: true, maxLinkCode: true },
    });
    expect(after?.maxChatId).toBe(chatId);
    expect(after?.maxLinkCode).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { userId: ids.u1, action: 'max_linked' },
    });
    expect(audit).toBeTruthy();
  });

  it('chat_taken когда chatId уже у другого пользователя', async () => {
    await generateMaxLinkCode(prisma, session(ids.u2));
    const u = await prisma.user.findUnique({
      where: { id: ids.u2 },
      select: { maxLinkCode: true },
    });
    const result = await linkMaxByCode(prisma, {
      code: u!.maxLinkCode!,
      chatId: `mc-linked-${STAMP}`, // уже у u1
    });
    expect(result).toEqual({ ok: false, error: 'chat_taken' });
  });

  it('истёкший код → invalid_code', async () => {
    await prisma.user.update({
      where: { id: ids.u2 },
      data: { maxLinkCode: 'expired-code', maxLinkCodeExpiresAt: new Date(Date.now() - 1000) },
    });
    const result = await linkMaxByCode(prisma, { code: 'expired-code', chatId: 'whatever' });
    expect(result).toEqual({ ok: false, error: 'invalid_code' });
  });
});

describe('unlinkMax', () => {
  it('чистит привязку и пишет audit', async () => {
    const result = await unlinkMax(prisma, session(ids.u1));
    expect(result).toEqual({ ok: true });
    const u = await prisma.user.findUnique({
      where: { id: ids.u1 },
      select: { maxChatId: true, maxLinkCode: true },
    });
    expect(u?.maxChatId).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { userId: ids.u1, action: 'max_unlinked' },
    });
    expect(audit).toBeTruthy();
  });
});
