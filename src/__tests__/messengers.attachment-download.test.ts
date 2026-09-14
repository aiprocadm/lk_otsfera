import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Скачивание вложения переписки (`У-204`, спека этапа 3 §3.3).
 *
 * Два разных вопроса: «пускать ли этого сотрудника» и «готов ли файл».
 * Коды не должны их смешивать: `not_found` — нет такого вложения в ЭТОМ
 * диалоге, `forbidden` — чужая компания, `not_ready` — проверка ещё идёт,
 * `infected` — карантин навсегда, `storage` — сбой хранилища (а не «нет файла»).
 */
const m = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
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
  sendTelegramDocument: vi.fn(),
  sendTelegramMessage: vi.fn(),
  getTelegramFileUrl: vi.fn(),
}));

import { getDialogAttachmentUrl } from '@/lib/services/messengers/attachment';

const findUnique = vi.fn();
const prisma = { messengerMessage: { findUnique } } as unknown as PrismaClient;
const session = { sub: 'u1', role: 'manager', companyId: 'c1' } as SessionPayload;

/** Вложение в своём диалоге, уже проверенное. */
function message(over: Record<string, unknown> = {}) {
  return {
    id: 'mm1',
    dialogId: 'd1',
    attachmentPath: 'messengers/d1/11111111-1111-1111-1111-111111111111-report.pdf',
    attachmentName: 'report.pdf',
    scanStatus: 'clean',
    dialog: { id: 'd1', companyId: 'c1' },
    ...over,
  };
}

const args = { dialogId: 'd1', messageId: 'mm1' };

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(message());
  m.createSignedUrl.mockResolvedValue('https://s3.local/signed');
});

describe('getDialogAttachmentUrl — кого пускать', () => {
  it('сообщения нет → not_found', async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(getDialogAttachmentUrl(prisma, session, args)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(m.createSignedUrl).not.toHaveBeenCalled();
  });

  it('сообщение есть, а вложения у него нет → not_found', async () => {
    findUnique.mockResolvedValueOnce(message({ attachmentPath: null }));
    await expect(getDialogAttachmentUrl(prisma, session, args)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('чужой messageId в адресе СВОЕГО диалога → not_found, ссылка не выдаётся', async () => {
    // Сообщение из диалога d2, а сотрудник открыл d1 и подставил его id.
    findUnique.mockResolvedValueOnce(message({ dialogId: 'd2' }));
    await expect(getDialogAttachmentUrl(prisma, session, args)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(m.createSignedUrl).not.toHaveBeenCalled();
  });

  it('диалог чужой компании → forbidden', async () => {
    findUnique.mockResolvedValueOnce(message({ dialog: { id: 'd1', companyId: 'c2' } }));
    await expect(getDialogAttachmentUrl(prisma, session, args)).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(m.createSignedUrl).not.toHaveBeenCalled();
  });

  it('сессия без компании → forbidden даже для привязанного диалога', async () => {
    await expect(
      getDialogAttachmentUrl(prisma, { ...session, companyId: null }, args)
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
  });

  it('ничей диалог (общая очередь) открыт любому сотруднику', async () => {
    // ДЕФЕКТ (в отчёт): `companyId: null` — общая очередь, и скоуп пускает в неё
    // сотрудника ЛЮБОЙ компании. Значит файл, загруженный в непривязанный диалог
    // компанией А, скачает и сотрудник компании Б. Это следует из решения Р-М-3
    // (общая очередь видна всем), но для файлов цена ошибки выше, чем для текста.
    findUnique.mockResolvedValueOnce(message({ dialog: { id: 'd1', companyId: null } }));
    await expect(
      getDialogAttachmentUrl(prisma, { ...session, companyId: 'совсем-другая' }, args)
    ).resolves.toEqual({ ok: true, url: 'https://s3.local/signed' });
  });

  it('путь вне префикса messengers/ → not_found (страховка от данных мимо сервиса)', async () => {
    findUnique.mockResolvedValueOnce(message({ attachmentPath: 'orders/o1/секретный.pdf' }));
    await expect(getDialogAttachmentUrl(prisma, session, args)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(m.createSignedUrl).not.toHaveBeenCalled();
  });
});

describe('getDialogAttachmentUrl — готов ли файл', () => {
  it('заражён → infected, ссылки нет', async () => {
    findUnique.mockResolvedValueOnce(message({ scanStatus: 'infected' }));
    await expect(getDialogAttachmentUrl(prisma, session, args)).resolves.toEqual({
      ok: false,
      error: 'infected',
    });
    expect(m.createSignedUrl).not.toHaveBeenCalled();
  });

  it.each(['pending', 'error', 'none'])('статус %s → not_ready, ссылки нет', async (scanStatus) => {
    findUnique.mockResolvedValueOnce(message({ scanStatus }));
    await expect(getDialogAttachmentUrl(prisma, session, args)).resolves.toEqual({
      ok: false,
      error: 'not_ready',
    });
    expect(m.createSignedUrl).not.toHaveBeenCalled();
  });

  it('clean → подписанная ссылка на 600 секунд с именем файла', async () => {
    const r = await getDialogAttachmentUrl(prisma, session, args);
    expect(r).toEqual({ ok: true, url: 'https://s3.local/signed' });
    expect(m.createSignedUrl).toHaveBeenCalledWith(
      'messengers/d1/11111111-1111-1111-1111-111111111111-report.pdf',
      600,
      { download: 'report.pdf' }
    );
  });

  it('clean без имени файла → ссылка без подсказки имени', async () => {
    findUnique.mockResolvedValueOnce(message({ attachmentName: null }));
    await getDialogAttachmentUrl(prisma, session, args);
    expect(m.createSignedUrl).toHaveBeenCalledWith(expect.any(String), 600, {});
  });
});

describe('getDialogAttachmentUrl — сбой хранилища', () => {
  it('подпись не удалась → storage, а НЕ not_found', async () => {
    m.createSignedUrl.mockRejectedValueOnce(new Error('S3 timeout'));
    await expect(getDialogAttachmentUrl(prisma, session, args)).resolves.toEqual({
      ok: false,
      error: 'storage',
    });
    expect(m.error).toHaveBeenCalled();
  });

  it('хранилище упало не ошибкой, а строкой → всё равно storage', async () => {
    m.createSignedUrl.mockRejectedValueOnce('no bucket');
    await expect(getDialogAttachmentUrl(prisma, session, args)).resolves.toEqual({
      ok: false,
      error: 'storage',
    });
  });
});
