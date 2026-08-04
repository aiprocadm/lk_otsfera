import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
// Разбор multipart — общий помощник из main; доменные импорты (хранилище,
// очередь, уведомления, magic bytes, аудит) уехали внутрь `uploadAdminDocument`,
// поэтому здесь их больше нет. `requireOrderAccess` удалён как дубль
// `canReadOrder` — проверка доступа к заказу теперь тоже в сервисе.
import { formFields, readFileEntry, readMultipart } from '@/lib/api/multipart';
import { forbiddenResponse, requireRole, requireSession } from '@/lib/auth/guard';
import { resolveMaxFileSizeMb, maxFileSizeBytes } from '@/lib/config/upload';
import { uploadAdminDocument } from '@/lib/services/documents/adminUpload';

/**
 * POST /api/documents/upload — legacy-канал загрузки из админ-панели.
 *
 * Роут остаётся тонким (§3): гарды → форма входа (наличие полей, MIME/
 * расширение, размер) → `uploadAdminDocument` → маппинг кода в HTTP. Размер и
 * MIME проверяются здесь намеренно: они отсекают файл ДО чтения его в память,
 * а доменные проверки (заказ, доступ, magic bytes, хранилище) живут в сервисе.
 */

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword', // .doc (legacy, §13)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'application/zip',
] as const;

const ALLOWED_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.xlsx',
  '.png',
  '.jpg',
  '.jpeg',
  '.zip',
] as const;
const ALLOWED_FORMATS_ERROR = `Unsupported file format. Allowed formats: ${ALLOWED_EXTENSIONS.join(', ')}`;

const FIELDS = z.object({ orderId: z.coerce.string().default('') });

const MAX_FILE_SIZE_MB = resolveMaxFileSizeMb();
const MAX_FILE_SIZE_BYTES = maxFileSizeBytes();

function errorResponse(code: string, message: string, status: number, correlationId?: string) {
  /* v8 ignore next -- correlationId is always crypto.randomUUID(); the {} branch is unreachable in practice */
  return NextResponse.json(
    { code, message, ...(correlationId ? { correlationId } : {}) },
    { status }
  );
}

export async function POST(req: Request) {
  const correlationId = crypto.randomUUID();
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const s = sessionResult.value;

  // Admin-only: the sole consumer is the admin DocumentsPanel. Partner and
  // organization uploads go through their channel-scoped paths (server-action /
  // manager API), which pin counterparty — this legacy route writes to the
  // org channel unconditionally and must not be reachable by other roles.
  const roleResult = requireRole(s, ['admin']);
  if (!roleResult.ok) return roleResult.response;

  const form = await readMultipart(req);
  if (!form)
    return errorResponse('BAD_REQUEST', 'Expected multipart form-data', 400, correlationId);
  const { orderId } = formFields(form, FIELDS);
  // Буфер читаем ПОСЛЕ проверок размера/MIME — отсюда readFileEntry, а не readFile.
  const file = readFileEntry(form, 'file');

  if (!orderId || !file) {
    return errorResponse('BAD_REQUEST', 'orderId and file are required', 400, correlationId);
  }

  const fileName = file.name.toLowerCase();
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) => fileName.endsWith(ext));

  if (
    !ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number]) ||
    !hasAllowedExtension
  ) {
    return errorResponse('INVALID_FILE_FORMAT', ALLOWED_FORMATS_ERROR, 400, correlationId);
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return errorResponse(
      'FILE_TOO_LARGE',
      `File exceeds ${MAX_FILE_SIZE_MB}MB limit`,
      400,
      correlationId
    );
  }

  const result = await uploadAdminDocument(prisma, s, {
    orderId,
    correlationId,
    file: {
      name: file.name,
      size: file.size,
      mimeType: file.type,
      buffer: Buffer.from(await file.arrayBuffer()),
    },
  });

  if (!result.ok) {
    switch (result.error) {
      case 'not_found':
        return errorResponse('NOT_FOUND', 'Not found', 404, correlationId);
      case 'forbidden':
        return forbiddenResponse();
      case 'organization_context_not_found':
        return errorResponse(
          'ORGANIZATION_CONTEXT_NOT_FOUND',
          'Organization context not found',
          400,
          correlationId
        );
      case 'invalid_file_format':
        return errorResponse('INVALID_FILE_FORMAT', ALLOWED_FORMATS_ERROR, 400, correlationId);
      default:
        return errorResponse(
          'STORAGE_UPLOAD_FAILED',
          'Failed to upload document',
          502,
          correlationId
        );
    }
  }

  return NextResponse.json(result.document);
}
