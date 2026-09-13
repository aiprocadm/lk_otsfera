import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

/**
 * Вложение Битрикса → `Document` (`У-191`, спека §3.3).
 *
 * Файл — единственная сущность, которую нельзя записать одной транзакцией:
 * сначала сеть (скачать, положить в хранилище), потом короткая транзакция
 * «строка документа + журнал», потом очередь антивируса. Проверяется именно
 * этот порядок и его отказы: на каждом шаге писатель обязан вернуть русскую
 * причину, а не бросить исключение — одно битое вложение не должно ронять
 * перенос целиком. Хранилище, очередь и логгер — моки: сеть и Redis здесь ни
 * при чём, а живой Postgres увёл бы файл в integration-слой.
 */
const { upload, getObjectStorage } = vi.hoisted(() => {
  const upload = vi.fn();
  return { upload, getObjectStorage: vi.fn(() => ({ upload })) };
});
vi.mock('@/lib/storage', () => ({ getObjectStorage }));

const { queueAdd, getQueue } = vi.hoisted(() => {
  const queueAdd = vi.fn();
  return { queueAdd, getQueue: vi.fn(() => ({ add: queueAdd })) };
});
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

const { log, bestEffort, swallowed } = vi.hoisted(() => {
  const swallowed = vi.fn();
  return {
    swallowed,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    bestEffort: vi.fn((label: string) => (err: unknown) => swallowed(label, err)),
  };
});
vi.mock('@/lib/logging', () => ({ log, bestEffort }));

import { mimeOf, writeFile } from '@/lib/services/bitrix/writers/files';
import type { ApplyContext } from '@/lib/services/bitrix/writers/journal';
import type { FileData } from '@/lib/services/bitrix/mapping/files';
import type { Plan } from '@/lib/services/bitrix/mapping/types';

const documentCreate = vi.fn();
const journalCreate = vi.fn();

const tx = {
  document: { create: documentCreate },
  bitrixImportWrite: { create: journalCreate },
};

const prisma = {
  $transaction: (cb: (client: typeof tx) => Promise<string>) => cb(tx),
} as unknown as PrismaClient;

const ctx: ApplyContext = {
  batchId: 'b1',
  companyId: 'c1',
  importerId: 'u-importer',
  defaultManagerId: 'm1',
  lastAfter: () => null,
};

/** Настоящая «шапка» PDF: проверку магических байтов зовут ту же, что кабинет. */
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n');

const SOURCE = { id: '1001', name: 'Акт.pdf', downloadUrl: 'https://portal/disk/1001' };

const plan = (over: Partial<FileData> = {}): Plan<FileData> => ({
  action: 'create',
  data: {
    companyId: 'c1',
    organizationId: 'o1',
    name: 'Акт сверки.pdf',
    size: PDF.length,
    downloadUrl: 'https://portal/disk/1001',
    bitrixId: '1001',
    ...over,
  },
});

const deps = (buffer: Buffer = PDF) => ({ download: vi.fn().mockResolvedValue(buffer) });

const envSizeLimit = process.env.DOCUMENT_MAX_FILE_SIZE_MB;

beforeEach(() => {
  vi.clearAllMocks();
  upload.mockResolvedValue(undefined);
  queueAdd.mockResolvedValue({ id: 'job-1' });
  documentCreate.mockResolvedValue({ id: 'doc-1' });
  journalCreate.mockResolvedValue({ id: 'w1' });
});

afterEach(() => {
  if (envSizeLimit === undefined) delete process.env.DOCUMENT_MAX_FILE_SIZE_MB;
  else process.env.DOCUMENT_MAX_FILE_SIZE_MB = envSizeLimit;
});

describe('mimeOf', () => {
  it.each([
    ['Акт.pdf', 'application/pdf'],
    ['Скан.jpg', 'image/jpeg'],
    ['Скан.jpeg', 'image/jpeg'],
    ['Печать.png', 'image/png'],
    ['Договор.doc', 'application/msword'],
    ['Договор.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['Смета.xls', 'application/vnd.ms-excel'],
    ['Смета.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    // Регистр расширения роли не играет: портал отдаёт имена как придётся.
    ['АКТ.PDF', 'application/pdf'],
  ])('%s → %s', (name, mime) => {
    expect(mimeOf(name)).toBe(mime);
  });

  it('неизвестное расширение и имя без расширения — «поток байтов»', () => {
    expect(mimeOf('чертёж.dwg')).toBe('application/octet-stream');
    expect(mimeOf('README')).toBe('application/octet-stream');
  });
});

describe('writeFile — отказы до записи', () => {
  it('план не про создание — переносить нечего', async () => {
    const d = deps();

    const out = await writeFile(
      prisma,
      ctx,
      { action: 'skip', reason: 'already_linked' },
      SOURCE,
      d
    );

    expect(out).toEqual({ ok: false, reason: 'нечего переносить' });
    expect(d.download).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(documentCreate).not.toHaveBeenCalled();
  });

  it('файл не скачался — причина несёт текст ошибки', async () => {
    const out = await writeFile(prisma, ctx, plan(), SOURCE, {
      download: vi.fn().mockRejectedValue(new Error('401 Unauthorized')),
    });

    expect(out).toEqual({ ok: false, reason: 'файл не скачался: 401 Unauthorized' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('скачивание упало не ошибкой — причина всё равно читаемая', async () => {
    const out = await writeFile(prisma, ctx, plan(), SOURCE, {
      download: vi.fn().mockRejectedValue('оборвалась сеть'),
    });

    expect(out).toEqual({ ok: false, reason: 'файл не скачался: оборвалась сеть' });
  });

  it('файл больше допустимого размера', async () => {
    process.env.DOCUMENT_MAX_FILE_SIZE_MB = '0.000001';

    const out = await writeFile(prisma, ctx, plan(), SOURCE, deps());

    expect(out).toEqual({ ok: false, reason: 'файл больше допустимого размера' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('тип файла не поддерживается — расширения нет в allow-list', async () => {
    const out = await writeFile(prisma, ctx, plan({ name: 'чертёж.dwg' }), SOURCE, deps());

    expect(out).toEqual({ ok: false, reason: 'тип файла не поддерживается' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('тип файла не поддерживается — имя обещает PDF, а байты не те', async () => {
    const out = await writeFile(
      prisma,
      ctx,
      plan(),
      SOURCE,
      deps(Buffer.from('это просто текст, а не PDF'))
    );

    expect(out).toEqual({ ok: false, reason: 'тип файла не поддерживается' });
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('writeFile — отказ хранилища', () => {
  it('хранилище недоступно — отказ с русской причиной и запись в журнал ошибок', async () => {
    upload.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const out = await writeFile(prisma, ctx, plan(), SOURCE, deps());

    expect(out).toEqual({ ok: false, reason: 'хранилище файлов недоступно' });
    expect(log.error).toHaveBeenCalledWith('[bitrix/files] storage upload failed', {
      file: 'Акт сверки.pdf',
      error: 'connect ECONNREFUSED',
    });
    expect(documentCreate).not.toHaveBeenCalled();
  });

  it('хранилище упало не ошибкой — в журнал ошибок уходит текст как есть', async () => {
    upload.mockRejectedValue('bucket не найден');

    const out = await writeFile(prisma, ctx, plan(), SOURCE, deps());

    expect(out).toEqual({ ok: false, reason: 'хранилище файлов недоступно' });
    expect(log.error).toHaveBeenCalledWith('[bitrix/files] storage upload failed', {
      file: 'Акт сверки.pdf',
      error: 'bucket не найден',
    });
  });
});

describe('writeFile — отказ записи документа', () => {
  it('повторный перенос того же вложения узнаётся по `bitrixId`', async () => {
    documentCreate.mockRejectedValue(
      new Error('Unique constraint failed on the fields: (`bitrixId`)')
    );

    const out = await writeFile(prisma, ctx, plan(), SOURCE, deps());

    expect(out).toEqual({ ok: false, reason: 'файл уже переносили' });
    expect(log.warn).toHaveBeenCalledWith('[bitrix/files] document not written', {
      file: 'Акт сверки.pdf',
      error: 'Unique constraint failed on the fields: (`bitrixId`)',
    });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('прочий сбой базы — общая причина', async () => {
    documentCreate.mockRejectedValue(new Error('deadlock detected'));

    const out = await writeFile(prisma, ctx, plan(), SOURCE, deps());

    expect(out).toEqual({ ok: false, reason: 'документ не записан' });
  });

  it('сбой не ошибкой — причина всё равно общая', async () => {
    journalCreate.mockRejectedValue('транзакция откатилась');

    const out = await writeFile(prisma, ctx, plan(), SOURCE, deps());

    expect(out).toEqual({ ok: false, reason: 'документ не записан' });
    expect(log.warn).toHaveBeenCalledWith('[bitrix/files] document not written', {
      file: 'Акт сверки.pdf',
      error: 'транзакция откатилась',
    });
  });
});

describe('writeFile — успех', () => {
  it('кладёт файл в хранилище, пишет документ и журнал, ставит задачу антивирусу', async () => {
    const d = deps();

    const out = await writeFile(prisma, ctx, plan(), SOURCE, d);

    expect(d.download).toHaveBeenCalledWith(SOURCE);

    // Путь: папка контрагента, случайное имя, безопасное имя файла.
    const path = upload.mock.calls[0][0];
    expect(path).toMatch(/^counterparty\/organization\/o1\/[0-9a-f-]{36}-[a-zA-Z0-9._-]+\.pdf$/);
    expect(upload).toHaveBeenCalledWith(path, PDF, { contentType: 'application/pdf' });

    expect(documentCreate).toHaveBeenCalledWith({
      data: {
        name: 'Акт сверки.pdf',
        path,
        mimeType: 'application/pdf',
        size: PDF.length,
        type: 'other',
        direction: 'incoming',
        companyId: 'c1',
        counterpartyType: 'organization',
        counterpartyId: 'o1',
        uploadedById: 'u-importer',
        generatedBy: 'system',
        scanStatus: 'pending',
        bitrixId: '1001',
      },
      select: { id: true },
    });

    // Журнал — в той же транзакции, что и документ.
    expect(journalCreate).toHaveBeenCalledWith({
      data: {
        batchId: 'b1',
        entity: 'file',
        entityId: 'doc-1',
        bitrixId: '1001',
        action: 'created',
        after: { name: 'Акт сверки.pdf', organizationId: 'o1', path },
      },
    });

    expect(getQueue).toHaveBeenCalledWith('docs.scanDocument');
    expect(queueAdd).toHaveBeenCalledWith('scan', { kind: 'document', id: 'doc-1' });
    expect(out).toEqual({
      ok: true,
      outcome: { entityId: 'doc-1', action: 'created', keptManual: [] },
    });
  });

  it('имя с кириллицей и пробелами в пути обезврежено, а в карточке остаётся как есть', async () => {
    await writeFile(prisma, ctx, plan({ name: 'Акт сверки №1.pdf' }), SOURCE, deps());

    const path = upload.mock.calls[0][0];
    expect(path.endsWith('____________1.pdf')).toBe(true);
    expect(documentCreate.mock.calls[0][0].data.name).toBe('Акт сверки №1.pdf');
  });

  it('сбой очереди антивируса не отменяет уже записанный документ', async () => {
    queueAdd.mockRejectedValue(new Error('Redis недоступен'));

    const out = await writeFile(prisma, ctx, plan(), SOURCE, deps());

    expect(out).toEqual({
      ok: true,
      outcome: { entityId: 'doc-1', action: 'created', keptManual: [] },
    });
    expect(bestEffort).toHaveBeenCalledWith('[bitrix/files] scan enqueue failed');
    expect(swallowed).toHaveBeenCalledWith('[bitrix/files] scan enqueue failed', expect.any(Error));
  });
});
