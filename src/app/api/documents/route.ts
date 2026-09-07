import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole, requireSession } from '@/lib/auth/guard';
import { listAllDocuments } from '@/lib/services/documents/list';

// This endpoint is consumed exclusively by the admin panel (DocumentsPanel).
// organization and partner roles are excluded: they must use channel-scoped service
// layer reads (organizationChannelWhere / partnerChannelWhere) so that cross-channel
// document metadata cannot leak via a direct authenticated GET. Managers are
// excluded too: their reads go through managerDocumentScope (the old manager
// branch here filtered via organizationUsers, which never matches a manager
// account and always returned an empty list).
export async function GET(req: Request) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const s = sessionResult.value;

  const roleResult = requireRole(s, ['admin']);
  if (!roleResult.ok) return roleResult.response;

  // Фильтр по заказу отбирает СЕРВЕР: карточке заказа не нужен список всей
  // платформы, чтобы показать три строки (`С-8`, хотфикс №18).
  const orderId = new URL(req.url).searchParams.get('orderId')?.trim();
  const result = await listAllDocuments(prisma, s, ...(orderId ? [{ orderId }] : []));

  return NextResponse.json({ rows: result.documents, total: result.total });
}
