import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { previewOf, upsertDialog } from '@/lib/services/messengers/dialog';

/**
 * Общие кирпичи диалога (спека 2026-09-12 §4): превью для списка и upsert по
 * собеседнику с одной повторной попыткой при гонке двух вебхуков.
 */
describe('previewOf', () => {
  it('сжимает переводы строк и пробелы в одну строку и обрезает края', () => {
    expect(previewOf('  Здравствуйте,\n\nхочу   счёт \t ')).toBe('Здравствуйте, хочу счёт');
  });

  it('ровно 200 символов — без многоточия, 201 — режется до 200 с «…»', () => {
    const exact = 'а'.repeat(200);
    expect(previewOf(exact)).toBe(exact);
    const long = 'б'.repeat(201);
    const cut = previewOf(long);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBe(201);
    expect(cut.startsWith('б'.repeat(200))).toBe(true);
  });

  it('пробел на границе обрезки не остаётся перед «…»', () => {
    const text = `${'в'.repeat(199)} ${'г'.repeat(50)}`;
    expect(previewOf(text)).toBe(`${'в'.repeat(199)}…`);
  });
});

describe('upsertDialog', () => {
  const upsert = vi.fn();
  const prisma = { messengerDialog: { upsert } } as unknown as PrismaClient;
  const key = { channel: 'telegram' as const, peerRef: 'chat-1' };
  const args = {
    create: { status: 'open', unreadCount: 1 },
    update: { unreadCount: { increment: 1 } },
  };
  const p2002 = () =>
    new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    } as never);

  beforeEach(() => upsert.mockReset());

  it('собирает where по уникальному ключу и подмешивает ключ в create', async () => {
    upsert.mockResolvedValue({ id: 'd1', companyId: null });
    await expect(upsertDialog(prisma, key, args)).resolves.toEqual({ id: 'd1', companyId: null });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({
      where: { channel_peerRef: { channel: 'telegram', peerRef: 'chat-1' } },
      create: { channel: 'telegram', peerRef: 'chat-1', status: 'open', unreadCount: 1 },
      update: { unreadCount: { increment: 1 } },
      select: { id: true, companyId: true },
    });
  });

  it('гонка (P2002 на первом заходе) → вторая попытка находит созданный диалог', async () => {
    upsert.mockRejectedValueOnce(p2002()).mockResolvedValueOnce({ id: 'd1', companyId: 'c1' });
    await expect(upsertDialog(prisma, key, args)).resolves.toEqual({ id: 'd1', companyId: 'c1' });
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('вторая P2002 подряд — не гонка, пробрасывается', async () => {
    upsert.mockRejectedValueOnce(p2002()).mockRejectedValueOnce(p2002());
    await expect(upsertDialog(prisma, key, args)).rejects.toMatchObject({ code: 'P2002' });
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('любая другая ошибка пробрасывается без повтора', async () => {
    upsert.mockRejectedValueOnce(new Error('db down'));
    await expect(upsertDialog(prisma, key, args)).rejects.toThrow('db down');
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
