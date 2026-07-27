import { NextRequest } from 'next/server';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { uploadCertificateScans } from '@/lib/services/manager/certificateScans';

/**
 * POST /api/manager/orders/[id]/certificate-scans — этап 12 PR-2 (ФТ-5.3).
 *
 * Массовая загрузка сканов удостоверений на заказ. Форма присылает пары
 * `file` + `orderItemId` **в одинаковом порядке**: i-й `orderItemId` относится
 * к i-му `file`. Сопоставление подтверждено менеджером в UI (ТЗ требует ручного
 * подтверждения) — сервер его не пересчитывает, только проверяет принадлежность
 * позиции заказу.
 *
 * Тонкий роут (§3 CLAUDE.md): вся логика — в `uploadCertificateScans`.
 *
 * Коды:
 *   200 — запрос обработан; body: { ok: true, results: [...] } — результат по
 *         каждому файлу отдельно (часть файлов может быть отклонена)
 *   400 — форма без файлов / число файлов не совпало с числом позиций
 *   403 — заказ вне скоупа менеджера
 *   404 — заказа нет
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const disabled = notFoundIfDisabled('manager_cabinet');
  if (disabled) return disabled;

  const session = await requireManager();
  const { id: orderId } = await params;

  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ ok: false, error: 'validation' }, { status: 400 });

  const rawFiles = form.getAll('file');
  const rawItemIds = form.getAll('orderItemId');
  const files = rawFiles.filter((f): f is File => f instanceof File);
  if (files.length === 0 || files.length !== rawItemIds.length) {
    return Response.json({ ok: false, error: 'validation' }, { status: 400 });
  }

  const payload = await Promise.all(
    files.map(async (file, index) => ({
      orderItemId: String(rawItemIds[index]),
      file: {
        name: file.name,
        size: file.size,
        mimeType: file.type,
        buffer: Buffer.from(await file.arrayBuffer())
      }
    }))
  );

  const result = await uploadCertificateScans(prisma, session, { orderId, files: payload });
  if (!result.ok) {
    const status = result.error === 'forbidden' ? 403 : result.error === 'not_found' ? 404 : 400;
    return Response.json({ ok: false, error: result.error }, { status });
  }

  return Response.json({ ok: true, results: result.results }, { status: 200 });
}
