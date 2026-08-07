import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { mayImportOneC } from '@/lib/auth/managerPolicy';
import { importScope } from '@/lib/services/oneCSync/scope';
import { normalizeInn, isValidInn } from '@/lib/services/oneCSync/inn';
import { recordAudit } from '@/lib/auth/audit';
import { log } from '@/lib/logging';
import { resolveQueueRow } from './resolve-queue';

/**
 * Создание организации из строки очереди разбора выписки (этап 10 ТЗ починки
 * импорта, Т-30). ТОЛЬКО по явному подтверждению оператора — автосоздание
 * запрещено решением владельца №5 (Т-30а, страж в тестах матчера).
 *
 * Права — `mayImportOneC` (admin и руководитель, по духу решения №2).
 * Компания новой организации — правила Т-41: руководитель → своя из скоупа
 * (параметр игнорируется), admin → выбор в диалоге. `externalId` не ставится:
 * ключ `1c-inn:<ИНН>` допишет первый же файловый импорт (backfill этапа 5).
 * Привязка платежа — композицией существующего `resolveQueueRow` (штатный
 * writer); упавшая привязка НЕ откатывает созданную организацию — оператор
 * довязывает штатной кнопкой (решение §8.3 спеки).
 */

type Err =
  'forbidden' | 'not_found' | 'name_required' | 'bad_inn' | 'org_exists' | 'company_required';

export async function createOrgFromQueueRow(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { rowId: string; name: string; inn: string; kpp?: string | null; companyId?: string }
): Promise<
  | { ok: true; organizationId: string; paymentId: string | null }
  | { ok: false; error: Err }
  | { ok: false; error: 'bind_failed'; organizationId: string; bindError: string }
> {
  if (!mayImportOneC(session)) return { ok: false, error: 'forbidden' };
  const row = await prisma.paymentImportRow.findUnique({
    where: { id: args.rowId },
    select: { id: true, status: true, batch: { select: { companyId: true } } },
  });
  if (!row || row.status !== 'needs_review') return { ok: false, error: 'not_found' };
  const scope = importScope(session);
  // Чужая компания для руководителя = «нет такой строки»: существование не раскрываем.
  if (scope.kind === 'company' && row.batch.companyId !== scope.companyId) {
    return { ok: false, error: 'not_found' };
  }
  // Руководитель без companyId деградирует в orgs-скоуп — создавать ему нельзя.
  if (scope.kind === 'orgs') return { ok: false, error: 'forbidden' };

  const name = args.name.trim();
  if (!name) return { ok: false, error: 'name_required' };
  const inn = normalizeInn(args.inn);
  if (!isValidInn(inn)) return { ok: false, error: 'bad_inn' };
  // Организация с таким ИНН уже есть → оператор привязывает ОСОЗНАННО штатной
  // кнопкой «Привязать», молча подменять его выбор нельзя (решение §8.2 спеки).
  const existing = await prisma.organization.findFirst({ where: { inn }, select: { id: true } });
  if (existing) return { ok: false, error: 'org_exists' };

  // Т-41: руководитель — своя компания; admin — выбор из диалога, с проверкой.
  const companyId = scope.kind === 'company' ? scope.companyId : (args.companyId ?? null);
  if (!companyId) return { ok: false, error: 'company_required' };
  if (scope.kind === 'global') {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) return { ok: false, error: 'company_required' };
  }

  const created = await prisma.organization.create({
    data: { name, inn, kpp: args.kpp?.trim() || null, companyId },
    select: { id: true },
  });
  try {
    await recordAudit(prisma, {
      userId: session.sub,
      action: 'organization_created_manual',
      entity: 'organization',
      entityId: created.id,
      after: { source: 'payment_queue', rowId: row.id, name, inn, companyId },
    });
  } catch (e) {
    log.error('[payment-queue] аудит создания организации не записан (non-blocking):', e);
  }

  const bind = await resolveQueueRow(prisma, session, {
    rowId: args.rowId,
    organizationId: created.id,
    orderId: null,
  });
  if (!bind.ok) {
    return { ok: false, error: 'bind_failed', organizationId: created.id, bindError: bind.error };
  }
  return { ok: true, organizationId: created.id, paymentId: bind.paymentId };
}
