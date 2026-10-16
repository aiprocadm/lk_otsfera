import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import { canSeeTask } from '@/lib/auth/accessProfile';
import { recordAudit } from '@/lib/auth/audit';
import { getObjectStorage } from '@/lib/storage';
import { validateMagicBytes, extensionFor } from '@/lib/storage/mimeValidator';
import { maxFileSizeBytes } from '@/lib/config/upload';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import { INFECTED_HIDDEN_WHERE } from '@/lib/services/scan/visibility';
import { bestEffort, log } from '@/lib/logging';

/**
 * Результат задачи (этап 5 ТЗ 13.10.2026, `У-299`, `Р-5-3`): что получилось —
 * текст и файлы.
 *
 * Права — те же, что на саму задачу: результат пишет и файлы прикладывает тот,
 * кто её видит (`canSeeTask`); чужая задача неотличима от несуществующей.
 * Удалить файл может тот, кто его загрузил, или постановщик задачи.
 *
 * Файлы — по правилам проекта для загрузок (§10): проверка размера и типа по
 * содержимому, хранилище, запись, журнал, антивирус в очереди (`pending →
 * clean | infected`), скачивание — временной ссылкой; заражённый файл не
 * скачивается и в списке не показывается.
 */

export type TaskResultError =
  'forbidden' | 'not_found' | 'validation' | 'too_large' | 'invalid_mime' | 'storage' | 'infected';

type Fail = { ok: false; error: TaskResultError };

const RESULT_MAX = 5000;
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

/** Задача в охвате сессии — для любого действия с результатом. */
async function loadTaskInScope(prisma: PrismaClient, session: SessionPayload, taskId: string) {
  if (!(session.role === 'admin' || isStaffManagerSide(session)) || !session.companyId) {
    return null;
  }
  const row = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      companyId: true,
      createdById: true,
      linkedOrganizationId: true,
      assignees: { select: { userId: true } },
    },
  });
  if (!row) return null;
  const visible = canSeeTask(session, {
    companyId: row.companyId,
    createdById: row.createdById,
    assigneeUserIds: row.assignees.map((a) => a.userId),
    linkedOrganizationId: row.linkedOrganizationId,
  });
  return visible ? row : null;
}

export async function setTaskResult(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { taskId: string; result: string }
): Promise<{ ok: true } | Fail> {
  const text = args.result.trim();
  if (text.length > RESULT_MAX) return { ok: false, error: 'validation' };
  const task = await loadTaskInScope(prisma, session, args.taskId);
  if (!task) return { ok: false, error: 'not_found' };
  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: task.id },
      data: { result: text || null, resultUpdatedAt: new Date() },
    });
    await recordAudit(tx, {
      userId: session.sub,
      action: 'task_result_set',
      entity: 'task',
      entityId: task.id,
      after: { length: text.length },
    });
  });
  return { ok: true };
}

export type TaskResultFileRow = {
  id: string;
  name: string;
  size: number;
  scanStatus: string;
  createdAt: Date;
  createdByName: string | null;
  /** Можно ли удалить: загрузил сам или постановщик задачи. */
  canDelete: boolean;
};

/** Файлы результата для карточки задачи; заражённые не показываются. */
export async function listTaskResultFiles(
  prisma: PrismaClient,
  session: SessionPayload,
  task: { id: string; createdById: string }
): Promise<TaskResultFileRow[]> {
  const rows = await prisma.taskResultFile.findMany({
    where: { taskId: task.id, ...INFECTED_HIDDEN_WHERE },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      size: true,
      scanStatus: true,
      createdAt: true,
      createdByUserId: true,
      createdByUser: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    size: r.size,
    scanStatus: r.scanStatus,
    createdAt: r.createdAt,
    createdByName: r.createdByUser?.name ?? null,
    canDelete: r.createdByUserId === session.sub || task.createdById === session.sub,
  }));
}

/** Имя файла без опасных символов; расширение ставит проверка типа. */
function safeName(name: string): string {
  return name
    .trim()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 200);
}

export async function uploadTaskResultFile(
  prisma: PrismaClient,
  session: SessionPayload,
  args: {
    taskId: string;
    file: { buffer: Uint8Array; name: string; declaredMimeType: string; size: number };
  }
): Promise<{ ok: true; id: string } | Fail> {
  const task = await loadTaskInScope(prisma, session, args.taskId);
  if (!task) return { ok: false, error: 'not_found' };
  if (args.file.size > maxFileSizeBytes()) return { ok: false, error: 'too_large' };
  const name = safeName(args.file.name);
  if (!name) return { ok: false, error: 'validation' };
  const check = validateMagicBytes(args.file.declaredMimeType, args.file.buffer);
  if (!check.ok) return { ok: false, error: 'invalid_mime' };

  const path = `task-results/${task.id}/${randomUUID()}.${extensionFor(check.mime)}`;
  const storage = getObjectStorage();
  try {
    await storage.upload(path, Buffer.from(args.file.buffer), { contentType: check.mime });
  } catch (e) {
    log.error('[task-result] storage upload failed', {
      taskId: task.id,
      providerError: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, error: 'storage' };
  }

  let id: string;
  try {
    id = await prisma.$transaction(async (tx) => {
      const created = await tx.taskResultFile.create({
        data: {
          taskId: task.id,
          createdByUserId: session.sub,
          name,
          path,
          mimeType: check.mime,
          size: args.file.size,
        },
        select: { id: true },
      });
      await recordAudit(tx, {
        userId: session.sub,
        action: 'task_result_file_uploaded',
        entity: 'task',
        entityId: task.id,
        after: { fileId: created.id, name, size: args.file.size },
      });
      return created.id;
    });
  } catch (err) {
    // Компенсация: запись не легла — объект в хранилище никому не нужен.
    await storage.remove([path]).catch(bestEffort('[task-result] orphan remove failed'));
    throw err;
  }

  // Антивирус — в очереди, best-effort (§3): сбой оставит `pending`.
  try {
    const payload: ScanDocumentPayload = { kind: 'task_result_file', id };
    await getQueue('docs.scanDocument').add('scan', payload);
  } catch (err) {
    log.warn('[task-result] enqueue scan failed', {
      fileId: id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return { ok: true, id };
}

async function loadFileInScope(prisma: PrismaClient, session: SessionPayload, fileId: string) {
  const file = await prisma.taskResultFile.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      taskId: true,
      name: true,
      path: true,
      scanStatus: true,
      createdByUserId: true,
    },
  });
  if (!file) return null;
  const task = await loadTaskInScope(prisma, session, file.taskId);
  return task ? { file, task } : null;
}

export async function deleteTaskResultFile(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { fileId: string }
): Promise<{ ok: true } | Fail> {
  const found = await loadFileInScope(prisma, session, args.fileId);
  if (!found) return { ok: false, error: 'not_found' };
  const { file, task } = found;
  if (file.createdByUserId !== session.sub && task.createdById !== session.sub) {
    return { ok: false, error: 'forbidden' };
  }
  await prisma.$transaction(async (tx) => {
    await tx.taskResultFile.delete({ where: { id: file.id } });
    await recordAudit(tx, {
      userId: session.sub,
      action: 'task_result_file_deleted',
      entity: 'task',
      entityId: task.id,
      after: { fileId: file.id, name: file.name },
    });
  });
  await getObjectStorage()
    .remove([file.path])
    .catch(bestEffort('[task-result] storage remove failed'));
  return { ok: true };
}

export async function getTaskResultFileUrl(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { fileId: string }
): Promise<{ ok: true; url: string } | Fail> {
  const found = await loadFileInScope(prisma, session, args.fileId);
  if (!found) return { ok: false, error: 'not_found' };
  if (found.file.scanStatus === 'infected') return { ok: false, error: 'infected' };
  try {
    const url = await getObjectStorage().createSignedUrl(
      found.file.path,
      DOWNLOAD_URL_TTL_SECONDS,
      { download: found.file.name }
    );
    return { ok: true, url };
  } catch (e) {
    log.error('[task-result] createSignedUrl failed', {
      fileId: found.file.id,
      providerError: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, error: 'storage' };
  }
}
