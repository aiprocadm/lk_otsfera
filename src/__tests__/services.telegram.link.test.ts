import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  getTelegramStatus,
  generateLinkCode,
  unlinkTelegram,
  linkByCode,
} from '@/lib/services/telegram/link';
import type { SessionPayload } from '@/lib/auth/jwt';

// Mock telegram/client so tests don't need real env or fetch
vi.mock('@/lib/telegram/client', () => ({
  isTelegramEnabled: vi.fn(() => false),
  botDeepLink: vi.fn((code: string) => `https://t.me/test_bot?start=${code}`),
}));

import { isTelegramEnabled, botDeepLink } from '@/lib/telegram/client';

const mockedEnabled = isTelegramEnabled as ReturnType<typeof vi.fn>;
const mockedDeepLink = botDeepLink as ReturnType<typeof vi.fn>;

let prisma: PrismaClient;

const STAMP = Date.now();

function makeSession(userId: string): SessionPayload {
  return { sub: userId, role: 'partner' };
}

let userA: { id: string };
let userB: { id: string };

beforeAll(async () => {
  prisma = new PrismaClient();

  userA = await prisma.user.create({
    data: {
      email: `tg-link-a-${STAMP}@t.local`,
      passwordHash: 'x',
      name: 'TgLinkA',
      role: 'partner',
    },
    select: { id: true },
  });

  userB = await prisma.user.create({
    data: {
      email: `tg-link-b-${STAMP}@t.local`,
      passwordHash: 'x',
      name: 'TgLinkB',
      role: 'partner',
    },
    select: { id: true },
  });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Reset telegram fields before each test
  await prisma.user.updateMany({
    where: { id: { in: [userA.id, userB.id] } },
    data: { telegramChatId: null, telegramLinkCode: null, telegramLinkCodeExpiresAt: null },
  });
  vi.clearAllMocks();
  mockedEnabled.mockReturnValue(false);
  mockedDeepLink.mockImplementation((code: string) => `https://t.me/test_bot?start=${code}`);
});

// ---- getTelegramStatus ----

describe('getTelegramStatus', () => {
  it('возвращает linked=false, enabled=false по умолчанию', async () => {
    const result = await getTelegramStatus(prisma, makeSession(userA.id));
    expect(result).toEqual({ ok: true, linked: false, enabled: false });
  });

  it('возвращает linked=true когда telegramChatId выставлен', async () => {
    await prisma.user.update({
      where: { id: userA.id },
      data: { telegramChatId: 'chat-id-123' },
    });
    const result = await getTelegramStatus(prisma, makeSession(userA.id));
    expect(result).toEqual({ ok: true, linked: true, enabled: false });
  });

  it('возвращает enabled=true когда isTelegramEnabled() true', async () => {
    mockedEnabled.mockReturnValue(true);
    const result = await getTelegramStatus(prisma, makeSession(userA.id));
    expect(result).toMatchObject({ ok: true, enabled: true });
  });
});

// ---- generateLinkCode ----

describe('generateLinkCode', () => {
  it('возвращает telegram_disabled если бот не настроен', async () => {
    mockedEnabled.mockReturnValue(false);
    const result = await generateLinkCode(prisma, makeSession(userA.id));
    expect(result).toEqual({ ok: false, error: 'telegram_disabled' });
  });

  it('генерирует код и deep-link если бот включён', async () => {
    mockedEnabled.mockReturnValue(true);
    const result = await generateLinkCode(prisma, makeSession(userA.id));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.deepLink).toMatch(/^https:\/\/t\.me\/test_bot\?start=\S+/);
  });

  it('сохраняет код и expiry на пользователе (срок +15 мин)', async () => {
    mockedEnabled.mockReturnValue(true);
    const before = Date.now();
    await generateLinkCode(prisma, makeSession(userA.id));
    const after = Date.now();

    const user = await prisma.user.findUnique({
      where: { id: userA.id },
      select: { telegramLinkCode: true, telegramLinkCodeExpiresAt: true },
    });
    expect(user?.telegramLinkCode).toBeTruthy();
    const expiry = user?.telegramLinkCodeExpiresAt?.getTime() ?? 0;
    const minExpiry = before + 14 * 60 * 1000;
    const maxExpiry = after + 16 * 60 * 1000;
    expect(expiry).toBeGreaterThanOrEqual(minExpiry);
    expect(expiry).toBeLessThanOrEqual(maxExpiry);
  });

  it('передаёт сгенерированный код в botDeepLink', async () => {
    mockedEnabled.mockReturnValue(true);
    await generateLinkCode(prisma, makeSession(userA.id));
    expect(mockedDeepLink).toHaveBeenCalledOnce();
    const [code] = mockedDeepLink.mock.calls[0] as [string];
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(0);
  });
});

// ---- linkByCode ----

describe('linkByCode', () => {
  async function seedCode(userId: string, expired = false) {
    const code = `test-code-${userId.slice(-4)}-${STAMP}`;
    const expiresAt = expired ? new Date(Date.now() - 1000) : new Date(Date.now() + 15 * 60 * 1000);
    await prisma.user.update({
      where: { id: userId },
      data: { telegramLinkCode: code, telegramLinkCodeExpiresAt: expiresAt },
    });
    return code;
  }

  it('привязывает chatId при валидном коде', async () => {
    const code = await seedCode(userA.id);
    const result = await linkByCode(prisma, { code, chatId: 'chat-a-1' });
    expect(result).toEqual({ ok: true });

    const user = await prisma.user.findUnique({
      where: { id: userA.id },
      select: { telegramChatId: true, telegramLinkCode: true },
    });
    expect(user?.telegramChatId).toBe('chat-a-1');
    expect(user?.telegramLinkCode).toBeNull();
  });

  it('возвращает invalid_code для просроченного кода', async () => {
    const code = await seedCode(userA.id, true);
    const result = await linkByCode(prisma, { code, chatId: 'chat-a-2' });
    expect(result).toEqual({ ok: false, error: 'invalid_code' });
  });

  it('возвращает invalid_code для несуществующего кода', async () => {
    const result = await linkByCode(prisma, { code: 'no-such-code', chatId: 'chat-x' });
    expect(result).toEqual({ ok: false, error: 'invalid_code' });
  });

  it('возвращает chat_taken если другой юзер уже имеет этот chatId', async () => {
    // Give userB the chatId first
    await prisma.user.update({
      where: { id: userB.id },
      data: { telegramChatId: 'chat-taken-99' },
    });
    const code = await seedCode(userA.id);
    const result = await linkByCode(prisma, { code, chatId: 'chat-taken-99' });
    expect(result).toEqual({ ok: false, error: 'chat_taken' });
  });

  it('пишет audit log telegram_linked при успехе', async () => {
    const code = await seedCode(userA.id);
    await linkByCode(prisma, { code, chatId: 'chat-audit' });
    const log = await prisma.auditLog.findFirst({
      where: { userId: userA.id, action: 'telegram_linked' },
    });
    expect(log).toBeTruthy();
    // Code must NOT appear in the audit log
    expect(JSON.stringify(log?.meta)).not.toContain(code);
  });
});

// ---- unlinkTelegram ----

describe('unlinkTelegram', () => {
  it('обнуляет telegramChatId и пишет audit telegram_unlinked', async () => {
    await prisma.user.update({
      where: { id: userA.id },
      data: { telegramChatId: 'chat-to-remove', telegramLinkCode: 'old-code' },
    });

    const result = await unlinkTelegram(prisma, makeSession(userA.id));
    expect(result).toEqual({ ok: true });

    const user = await prisma.user.findUnique({
      where: { id: userA.id },
      select: { telegramChatId: true, telegramLinkCode: true },
    });
    expect(user?.telegramChatId).toBeNull();
    expect(user?.telegramLinkCode).toBeNull();

    const log = await prisma.auditLog.findFirst({
      where: { userId: userA.id, action: 'telegram_unlinked' },
    });
    expect(log).toBeTruthy();
  });
});

// ---- Full cycle ----

describe('полный цикл generate→link→status→unlink', () => {
  it('проходит все шаги без ошибок', async () => {
    mockedEnabled.mockReturnValue(true);

    // 1. Generate
    const genResult = await generateLinkCode(prisma, makeSession(userA.id));
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) throw new Error('generate failed');

    // Extract code from deep-link mock call
    const [code] = mockedDeepLink.mock.calls[0] as [string];

    // 2. Link by code
    const linkResult = await linkByCode(prisma, { code, chatId: 'chat-cycle-1' });
    expect(linkResult).toEqual({ ok: true });

    // 3. Status
    mockedEnabled.mockReturnValue(true);
    const status = await getTelegramStatus(prisma, makeSession(userA.id));
    expect(status).toEqual({ ok: true, linked: true, enabled: true });

    // 4. Unlink
    const unlinkResult = await unlinkTelegram(prisma, makeSession(userA.id));
    expect(unlinkResult).toEqual({ ok: true });

    const afterUnlink = await getTelegramStatus(prisma, makeSession(userA.id));
    expect(afterUnlink.linked).toBe(false);
  });

  it('уникальность chatId: нельзя привязать один chat к двум юзерам', async () => {
    mockedEnabled.mockReturnValue(true);

    // Link userA
    const codeA = `unique-a-${STAMP}`;
    await prisma.user.update({
      where: { id: userA.id },
      data: {
        telegramLinkCode: codeA,
        telegramLinkCodeExpiresAt: new Date(Date.now() + 60000),
      },
    });
    await linkByCode(prisma, { code: codeA, chatId: 'shared-chat' });

    // Try to link userB with the same chatId
    const codeB = `unique-b-${STAMP}`;
    await prisma.user.update({
      where: { id: userB.id },
      data: {
        telegramLinkCode: codeB,
        telegramLinkCodeExpiresAt: new Date(Date.now() + 60000),
      },
    });
    const result = await linkByCode(prisma, { code: codeB, chatId: 'shared-chat' });
    expect(result).toEqual({ ok: false, error: 'chat_taken' });
  });
});
