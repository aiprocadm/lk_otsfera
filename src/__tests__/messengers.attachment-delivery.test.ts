import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

/**
 * Ворота «файл уходит клиенту только после clean» (`У-204`, спека §3.3).
 *
 * `deliverScannedAttachment` зовёт антивирусный процессор, когда проверка
 * закончилась. Здесь проверяется главное обещание этапа: заражённый файл не
 * уходит НИКУДА, а повтор задачи не отправляет один и тот же файл дважды.
 *
 * Транспорт не мокаем — мокаем сетевой клиент под ним: так видно и решение
 * «в этот канал файлы можно», и сам факт вызова.
 */
const m = vi.hoisted(() => ({
  download: vi.fn(),
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
  remove: vi.fn(),
  sendTelegramDocument: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    upload: m.upload,
    createSignedUrl: m.createSignedUrl,
    download: m.download,
    remove: m.remove,
  }),
}));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: vi.fn() }) }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/logging', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: m.error },
  bestEffort: () => vi.fn(),
}));
vi.mock('@/lib/telegram/client', () => ({
  sendTelegramDocument: m.sendTelegramDocument,
  sendTelegramMessage: vi.fn(),
  getTelegramFileUrl: vi.fn(),
}));

import { deliverScannedAttachment } from '@/lib/services/messengers/attachment';

const findUnique = vi.fn();
const update = vi.fn();
/**
 * Захват отправки: `updateMany({where:{id, deliveryStatus:'pending'}})`
 * переводит строку в `sending`, и продолжает только тот вызов, который
 * действительно её перевёл (`count === 1`). Мок по умолчанию отдаёт захват
 * первому обратившемуся, остальным — `count: 0`.
 */
const updateMany = vi.fn();
const prisma = {
  messengerMessage: { findUnique, update, updateMany },
} as unknown as PrismaClient;

const fileBytes = Buffer.from('%PDF-1.7 содержимое');

/** Исходящее вложение, проверку прошло, клиенту ещё не ушло. */
function outgoing(over: Record<string, unknown> = {}) {
  return {
    id: 'mm1',
    direction: 'out',
    deliveryStatus: 'pending',
    scanStatus: 'clean',
    attachmentPath: 'messengers/d1/uuid-report.pdf',
    attachmentName: 'report.pdf',
    attachmentMime: 'application/pdf',
    dialog: { id: 'd1', channel: 'telegram', peerRef: 'chat-77' },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(outgoing());
  let claimed = false;
  updateMany.mockImplementation(async () => {
    if (claimed) return { count: 0 };
    claimed = true;
    return { count: 1 };
  });
  update.mockResolvedValue({});
  m.download.mockResolvedValue(fileBytes);
  m.sendTelegramDocument.mockResolvedValue({ ok: true });
});

describe('deliverScannedAttachment — что вообще не отправляется', () => {
  it('сообщения нет → skipped', async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(deliverScannedAttachment(prisma, 'нет-такого')).resolves.toEqual({
      delivered: false,
      reason: 'skipped',
    });
    expect(m.sendTelegramDocument).not.toHaveBeenCalled();
  });

  it('входящее сообщение (файл клиента) → skipped, клиенту его не пересылают', async () => {
    findUnique.mockResolvedValueOnce(outgoing({ direction: 'in' }));
    await expect(deliverScannedAttachment(prisma, 'mm1')).resolves.toEqual({
      delivered: false,
      reason: 'skipped',
    });
    expect(m.download).not.toHaveBeenCalled();
    expect(m.sendTelegramDocument).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('уже отправленное (sent) → skipped: повтор задачи не отправит файл второй раз', async () => {
    findUnique.mockResolvedValueOnce(outgoing({ deliveryStatus: 'sent' }));
    await expect(deliverScannedAttachment(prisma, 'mm1')).resolves.toEqual({
      delivered: false,
      reason: 'skipped',
    });
    expect(m.sendTelegramDocument).not.toHaveBeenCalled();
  });

  it('уже провалившееся (failed) → skipped', async () => {
    findUnique.mockResolvedValueOnce(outgoing({ deliveryStatus: 'failed' }));
    await expect(deliverScannedAttachment(prisma, 'mm1')).resolves.toEqual({
      delivered: false,
      reason: 'skipped',
    });
  });
});

describe('deliverScannedAttachment — гейт антивируса', () => {
  it('заражён → в транспорт НИЧЕГО не уходит, доставка помечается failed', async () => {
    findUnique.mockResolvedValueOnce(outgoing({ scanStatus: 'infected' }));
    const r = await deliverScannedAttachment(prisma, 'mm1');
    expect(r).toEqual({ delivered: false, reason: 'infected' });
    expect(m.download).not.toHaveBeenCalled();
    expect(m.sendTelegramDocument).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'mm1' },
      data: { deliveryStatus: 'failed' },
    });
  });

  it.each(['error', 'pending', 'none'])(
    'непроверенный статус %s → файл не уходит, доставка failed',
    async (scanStatus) => {
      findUnique.mockResolvedValueOnce(outgoing({ scanStatus }));
      const r = await deliverScannedAttachment(prisma, 'mm1');
      expect(r).toEqual({ delivered: false, reason: scanStatus });
      expect(m.sendTelegramDocument).not.toHaveBeenCalled();
    }
  );

  it('clean, но строки файла нет → no_file и честный failed, а не вечное «ожидание»', async () => {
    // Тупик «файла нет, а статус ждёт отправки» закрыт: сообщение уходит в
    // `failed`, иначе лента показывала бы вечное «проверяется».
    findUnique.mockResolvedValueOnce(outgoing({ attachmentPath: null }));
    const r = await deliverScannedAttachment(prisma, 'mm1');
    expect(r).toEqual({ delivered: false, reason: 'no_file' });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'mm1' },
      data: { deliveryStatus: 'failed' },
    });
  });
});

describe('deliverScannedAttachment — проверенный файл уходит клиенту', () => {
  it('clean → скачивание из хранилища, отправка в канал диалога, статус sent', async () => {
    const r = await deliverScannedAttachment(prisma, 'mm1');
    expect(r).toEqual({ delivered: true });
    expect(m.download).toHaveBeenCalledWith('messengers/d1/uuid-report.pdf');
    expect(m.sendTelegramDocument).toHaveBeenCalledWith(
      'chat-77',
      { name: 'report.pdf', mimeType: 'application/pdf', buffer: fileBytes },
      undefined
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'mm1' },
      data: { deliveryStatus: 'sent' },
    });
  });

  it('без имени и типа файла уходят безопасные значения по умолчанию', async () => {
    findUnique.mockResolvedValueOnce(outgoing({ attachmentName: null, attachmentMime: null }));
    await deliverScannedAttachment(prisma, 'mm1');
    expect(m.sendTelegramDocument).toHaveBeenCalledWith(
      'chat-77',
      { name: 'file', mimeType: 'application/octet-stream', buffer: fileBytes },
      undefined
    );
  });

  it('канал файлы не принимает (whatsapp) → отправки нет, статус failed', async () => {
    findUnique.mockResolvedValueOnce(
      outgoing({ dialog: { id: 'd1', channel: 'whatsapp', peerRef: '+79990000000' } })
    );
    const r = await deliverScannedAttachment(prisma, 'mm1');
    expect(r).toEqual({ delivered: false, reason: 'transport' });
    expect(m.sendTelegramDocument).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'mm1' },
      data: { deliveryStatus: 'failed' },
    });
  });
});

describe('deliverScannedAttachment — когда не получилось', () => {
  it('транспорт отказал → failed', async () => {
    m.sendTelegramDocument.mockResolvedValueOnce({ ok: false });
    const r = await deliverScannedAttachment(prisma, 'mm1');
    expect(r).toEqual({ delivered: false, reason: 'transport' });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'mm1' },
      data: { deliveryStatus: 'failed' },
    });
  });

  it('транспорт бросил исключение → failed, наружу ничего не летит', async () => {
    m.sendTelegramDocument.mockRejectedValueOnce(new Error('сеть'));
    await expect(deliverScannedAttachment(prisma, 'mm1')).resolves.toEqual({
      delivered: false,
      reason: 'transport',
    });
  });

  it('файл не скачался → failed, транспорт НЕ зван', async () => {
    m.download.mockRejectedValueOnce(new Error('S3 down'));
    const r = await deliverScannedAttachment(prisma, 'mm1');
    expect(r).toEqual({ delivered: false, reason: 'storage' });
    expect(m.sendTelegramDocument).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'mm1' },
      data: { deliveryStatus: 'failed' },
    });
    expect(m.error).toHaveBeenCalled();
  });

  it('хранилище упало не ошибкой, а строкой → тот же исход', async () => {
    m.download.mockRejectedValueOnce('S3 down');
    await expect(deliverScannedAttachment(prisma, 'mm1')).resolves.toEqual({
      delivered: false,
      reason: 'storage',
    });
  });
});

describe('deliverScannedAttachment — идемпотентность', () => {
  it('повтор задачи ПОСЛЕ успешной отправки файл второй раз не шлёт', async () => {
    await deliverScannedAttachment(prisma, 'mm1');
    expect(m.sendTelegramDocument).toHaveBeenCalledTimes(1);
    // Вторая попытка видит уже отправленное сообщение.
    findUnique.mockResolvedValueOnce(outgoing({ deliveryStatus: 'sent' }));
    await deliverScannedAttachment(prisma, 'mm1');
    expect(m.sendTelegramDocument).toHaveBeenCalledTimes(1);
  });

  it('две задачи ОДНОВРЕМЕННО — файл уходит клиенту ровно один раз', async () => {
    // Чтение статуса и запись результата разделены окном: два воркера (или
    // повтор BullMQ, запущенный до конца первой попытки) оба увидели бы
    // `pending`. Поэтому отправку захватывает одна атомарная запись — тот же
    // приём, что у привязки диалога в `send.ts`.
    const results = await Promise.all([
      deliverScannedAttachment(prisma, 'mm1'),
      deliverScannedAttachment(prisma, 'mm1'),
    ]);
    expect(m.sendTelegramDocument).toHaveBeenCalledTimes(1);
    // Проигравший захват честно отвечает «пропущено», а не «отправлено».
    expect(results.filter((r) => r.delivered)).toHaveLength(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'mm1', deliveryStatus: 'pending' },
      data: { deliveryStatus: 'sending' },
    });
  });
});
