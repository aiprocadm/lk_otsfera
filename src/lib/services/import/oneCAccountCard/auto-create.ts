import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { importScope } from '@/lib/services/oneCSync/scope';
import { recordAudit } from '@/lib/auth/audit';
import { log } from '@/lib/logging';
import type { NewCounterparty } from './new-counterparties';

/**
 * Автосоздание организаций при импорте выписки (`У-49`, `У-50`, `У-54`).
 *
 * Прежний запрет (решение владельца №5, страж `Т-30а`) **отменён решением
 * `Р-2`**: система создаёт организацию сама, если ИНН прошёл проверку
 * контрольной суммы и организации с таким ИНН ещё нет. Страховки уехали
 * раньше — предпросмотр (`У-52`) и откат (`У-59`) уже работают.
 *
 * Создание живёт здесь, а не в матчере: матчер — чистый поиск, он ничего не
 * пишет. Порядок в импорте такой: создать организации → и матчер сам найдёт их
 * по ИНН. Отдельной ветки «привязать вручную» не появляется.
 */
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Компания новой организации (`У-50`).
 *
 * Руководитель — своя из скоупа (аргумент игнорируется), администратор —
 * выбранная в форме. Обычный менеджер (скоуп по своим организациям) новых
 * организаций не заводит вовсе: это правило пришло вместе с допуском менеджера
 * к импорту и здесь не смягчается — его строки просто уходят в очередь.
 */
export function resolveNewOrgCompany(
  session: SessionPayload,
  companyId?: string | undefined
): { ok: true; companyId: string } | { ok: false; error: 'company_required' | 'not_allowed' } {
  const scope = importScope(session);
  if (scope.kind === 'company') return { ok: true, companyId: scope.companyId };
  if (scope.kind === 'orgs') return { ok: false, error: 'not_allowed' };
  const chosen = companyId?.trim();
  if (!chosen) return { ok: false, error: 'company_required' };
  return { ok: true, companyId: chosen };
}

/**
 * Создаёт организации по списку предпросмотра и возвращает их id по ИНН.
 *
 * Каждая созданная организация попадает **и в аудит** с источником
 * `payment_import_auto` (`У-54`), **и в след записи батча** (`У-59`) — иначе
 * откат импорта оставил бы после себя осиротевшие организации.
 * `externalId` не ставится: ключ `1c-inn:<ИНН>` допишет первый же файловый
 * импорт — то же правило, что в ручном создании из очереди.
 */
export async function createOrganizationsForImport(
  db: Db,
  session: SessionPayload,
  args: { candidates: NewCounterparty[]; companyId: string; batchId: string; fileName: string }
): Promise<Map<string, string>> {
  const byInn = new Map<string, string>();
  for (const c of args.candidates) {
    const created = await db.organization.create({
      data: {
        // Название в выписке бывает пустым — тогда человеку нужен хоть
        // какой-то опознаваемый ярлык, а не пустая строка в списке.
        name: c.name || `Организация по ИНН ${c.inn}`,
        inn: c.inn,
        companyId: args.companyId,
      },
      select: { id: true },
    });
    byInn.set(c.inn, created.id);
    await db.paymentImportWrite.create({
      data: {
        batchId: args.batchId,
        entity: 'organization',
        entityId: created.id,
        action: 'created',
      },
    });
    // Аудит — источник, по которому карточка рисует плашку «создана
    // автоматически» (`У-54`). Падение аудита не рвёт импорт (§3), но лог
    // обязателен: без записи плашки не будет.
    try {
      await recordAudit(db, {
        userId: session.sub,
        action: 'organization_created_auto',
        entity: 'organization',
        entityId: created.id,
        after: {
          source: 'payment_import_auto',
          fileName: args.fileName,
          batchId: args.batchId,
          name: c.name,
          inn: c.inn,
          companyId: args.companyId,
        },
      });
    } catch (e) {
      log.error('[card51] аудит автосоздания организации не записан:', e);
    }
  }
  return byInn;
}
