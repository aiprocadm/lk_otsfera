import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Результат задачи (этап 5 ТЗ 13.10.2026, `У-299`, `Р-5-3`): текст и файлы.
 * Хранилище и очередь антивируса подменены — проверяется логика сервиса:
 * охват задачи, проверки файла, журнал, компенсация при сбое, коды ошибок.
 * Запись в живую базу — в services.tasks.result.integration.test.ts.
 */
const { storage, queueAdd, recordAudit, validateMagicBytes } = vi.hoisted(() => ({
  storage: { upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn() },
  queueAdd: vi.fn(),
  recordAudit: vi.fn(),
  validateMagicBytes: vi.fn(),
}));
vi.mock('@/lib/storage', () => ({ getObjectStorage: () => storage }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: queueAdd }) }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/storage/mimeValidator', () => ({
  validateMagicBytes,
  extensionFor: () => 'pdf',
}));
vi.mock('@/lib/config/upload', () => ({ maxFileSizeBytes: () => 100 }));

import {
  setTaskResult,
  uploadTaskResultFile,
  deleteTaskResultFile,
  getTaskResultFileUrl,
} from '@/lib/services/tasks/result';
import type { SessionPayload } from '@/lib/auth/jwt';

const manager = { sub: 'm1', role: 'manager', companyId: 'co-1' } as SessionPayload;
const TASK = {
  id: 't1',
  companyId: 'co-1',
  createdById: 'boss',
  linkedOrganizationId: null,
  assignees: [{ userId: 'm1' }],
};
const FILE = {
  id: 'f1',
  taskId: 't1',
  name: 'акт.pdf',
  path: 'task-results/t1/x.pdf',
  scanStatus: 'clean',
  createdByUserId: 'm1',
};

function db(
  over: { task?: unknown; file?: unknown; create?: (...args: unknown[]) => unknown } = {}
) {
  const tx = {
    task: { update: vi.fn() },
    taskResultFile: {
      create: vi.fn<(...args: unknown[]) => unknown>(
        over.create ?? (async () => ({ id: 'f-new' }))
      ),
      delete: vi.fn(),
    },
  };
  return {
    tx,
    prisma: {
      task: { findUnique: vi.fn().mockResolvedValue('task' in over ? over.task : TASK) },
      taskResultFile: { findUnique: vi.fn().mockResolvedValue('file' in over ? over.file : FILE) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    } as never,
  };
}

const file = (size = 10) => ({
  buffer: new Uint8Array([1, 2]),
  name: '  акт/1.pdf ',
  declaredMimeType: 'application/pdf',
  size,
});

beforeEach(() => {
  vi.clearAllMocks();
  validateMagicBytes.mockReturnValue({ ok: true, mime: 'application/pdf' });
  storage.upload.mockResolvedValue(undefined);
  storage.remove.mockResolvedValue(undefined);
  storage.createSignedUrl.mockResolvedValue('https://s3/x');
  queueAdd.mockResolvedValue(undefined);
});

describe('setTaskResult', () => {
  it('пишет текст и время, пустой текст — «результата нет»', async () => {
    const { prisma, tx } = db();
    expect(await setTaskResult(prisma, manager, { taskId: 't1', result: '  Сделано  ' })).toEqual({
      ok: true,
    });
    expect(tx.task.update.mock.calls[0][0].data.result).toBe('Сделано');
    expect(recordAudit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'task_result_set', entityId: 't1' })
    );
    await setTaskResult(prisma, manager, { taskId: 't1', result: '   ' });
    expect(tx.task.update.mock.calls[1][0].data.result).toBeNull();
  });

  it('слишком длинный — validation; чужая, несуществующая, не сотрудник — not_found', async () => {
    const { prisma } = db();
    expect(
      await setTaskResult(prisma, manager, { taskId: 't1', result: 'x'.repeat(5001) })
    ).toEqual({ ok: false, error: 'validation' });
    expect(
      await setTaskResult(db({ task: { ...TASK, companyId: 'other' } }).prisma, manager, {
        taskId: 't1',
        result: 'x',
      })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(
      await setTaskResult(db({ task: null }).prisma, manager, { taskId: 't1', result: 'x' })
    ).toEqual({ ok: false, error: 'not_found' });
    const org = { sub: 'o', role: 'organization', companyId: 'co-1' } as SessionPayload;
    expect(await setTaskResult(prisma, org, { taskId: 't1', result: 'x' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    const noCo = { sub: 'm1', role: 'manager' } as SessionPayload;
    expect(await setTaskResult(prisma, noCo, { taskId: 't1', result: 'x' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});

describe('uploadTaskResultFile', () => {
  it('кладёт в хранилище, пишет запись и журнал, ставит антивирус', async () => {
    const { prisma, tx } = db();
    expect(await uploadTaskResultFile(prisma, manager, { taskId: 't1', file: file() })).toEqual({
      ok: true,
      id: 'f-new',
    });
    const path = storage.upload.mock.calls[0][0] as string;
    expect(path).toMatch(/^task-results\/t1\/.+\.pdf$/);
    expect((tx.taskResultFile.create.mock.calls[0]![0] as { data: unknown }).data).toMatchObject({
      taskId: 't1',
      createdByUserId: 'm1',
      name: 'акт_1.pdf',
      mimeType: 'application/pdf',
    });
    expect(queueAdd).toHaveBeenCalledWith('scan', { kind: 'task_result_file', id: 'f-new' });
  });

  it('большой, без имени, чужого типа, в чужой задаче — отказ до хранилища', async () => {
    const { prisma } = db();
    expect(await uploadTaskResultFile(prisma, manager, { taskId: 't1', file: file(101) })).toEqual({
      ok: false,
      error: 'too_large',
    });
    expect(
      await uploadTaskResultFile(prisma, manager, { taskId: 't1', file: { ...file(), name: '  ' } })
    ).toEqual({ ok: false, error: 'validation' });
    validateMagicBytes.mockReturnValue({ ok: false, reason: 'exe' });
    expect(await uploadTaskResultFile(prisma, manager, { taskId: 't1', file: file() })).toEqual({
      ok: false,
      error: 'invalid_mime',
    });
    expect(
      await uploadTaskResultFile(db({ task: null }).prisma, manager, { taskId: 't1', file: file() })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('хранилище упало — storage; запись упала — объект убирается и ошибка летит дальше', async () => {
    storage.upload.mockRejectedValueOnce(new Error('s3 down'));
    expect(
      await uploadTaskResultFile(db().prisma, manager, { taskId: 't1', file: file() })
    ).toEqual({ ok: false, error: 'storage' });
    storage.upload.mockRejectedValueOnce('строка');
    expect(
      await uploadTaskResultFile(db().prisma, manager, { taskId: 't1', file: file() })
    ).toEqual({ ok: false, error: 'storage' });
    const broken = db({
      create: async () => {
        throw new Error('db down');
      },
    });
    await expect(
      uploadTaskResultFile(broken.prisma, manager, { taskId: 't1', file: file() })
    ).rejects.toThrow('db down');
    expect(storage.remove).toHaveBeenCalled();
  });

  it('очередь антивируса недоступна — файл всё равно приложен (проверит повтор)', async () => {
    queueAdd.mockRejectedValueOnce(new Error('redis down'));
    expect(
      await uploadTaskResultFile(db().prisma, manager, { taskId: 't1', file: file() })
    ).toEqual({ ok: true, id: 'f-new' });
    queueAdd.mockRejectedValueOnce('строка');
    expect(
      (await uploadTaskResultFile(db().prisma, manager, { taskId: 't1', file: file() })).ok
    ).toBe(true);
  });
});

describe('deleteTaskResultFile', () => {
  it('удаляет свой файл и постановщик — чужой; остальным — forbidden', async () => {
    const own = db();
    expect(await deleteTaskResultFile(own.prisma, manager, { fileId: 'f1' })).toEqual({ ok: true });
    expect(own.tx.taskResultFile.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
    expect(storage.remove).toHaveBeenCalledWith(['task-results/t1/x.pdf']);

    const boss = { ...manager, sub: 'boss' } as SessionPayload;
    expect(
      await deleteTaskResultFile(db({ file: { ...FILE, createdByUserId: 'x' } }).prisma, boss, {
        fileId: 'f1',
      })
    ).toEqual({ ok: true });

    const stranger = db({ file: { ...FILE, createdByUserId: 'x' } });
    expect(await deleteTaskResultFile(stranger.prisma, manager, { fileId: 'f1' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(
      await deleteTaskResultFile(db({ file: null }).prisma, manager, { fileId: 'f1' })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(
      await deleteTaskResultFile(db({ task: null }).prisma, manager, { fileId: 'f1' })
    ).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('getTaskResultFileUrl', () => {
  it('временная ссылка; заражённый — infected; сбой хранилища — storage', async () => {
    expect(await getTaskResultFileUrl(db().prisma, manager, { fileId: 'f1' })).toEqual({
      ok: true,
      url: 'https://s3/x',
    });
    expect(storage.createSignedUrl).toHaveBeenCalledWith('task-results/t1/x.pdf', 300, {
      download: 'акт.pdf',
    });
    expect(
      await getTaskResultFileUrl(
        db({ file: { ...FILE, scanStatus: 'infected' } }).prisma,
        manager,
        {
          fileId: 'f1',
        }
      )
    ).toEqual({ ok: false, error: 'infected' });
    storage.createSignedUrl.mockRejectedValueOnce(new Error('s3'));
    expect(await getTaskResultFileUrl(db().prisma, manager, { fileId: 'f1' })).toEqual({
      ok: false,
      error: 'storage',
    });
    storage.createSignedUrl.mockRejectedValueOnce('строка');
    expect((await getTaskResultFileUrl(db().prisma, manager, { fileId: 'f1' })).ok).toBe(false);
    expect(
      await getTaskResultFileUrl(db({ file: null }).prisma, manager, { fileId: 'f1' })
    ).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});
