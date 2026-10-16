import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import { recordAudit } from '@/lib/auth/audit';
import { organizationNameKey } from '@/lib/services/import/oneCAccountCard/counterparty-key';

/**
 * «Создать организацию» из кабинета менеджера (этап 6 ТЗ 13.10.2026, `У-308`,
 * `Р-6-8`): новая организация — в компании сотрудника и **сразу закреплена за
 * ним** (`OrganizationManager`; администратору закрепление не нужно), иначе без командного режима он её не увидел
 * бы. Тот же сервис зовёт форма контакта («Создать новую», `У-309`).
 *
 * Дубли не плодим: ИНН уникален глобально — тёзка в своей компании
 * возвращается как «уже есть» с её id, в чужой — отказ; без ИНН дубль ищется
 * по ключу названия в своей компании.
 */
export type CreateOrgByManagerError =
  'forbidden' | 'validation' | 'org_exists' | 'org_in_other_company';

export async function createOrganizationByManager(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { name: string; inn?: string | null | undefined }
): Promise<
  | { ok: true; organizationId: string; name: string }
  | { ok: false; error: CreateOrgByManagerError; organizationId?: string }
> {
  // Администратор тоже: форма контакта есть и в его кабинете (Model A).
  const managerSide = isStaffManagerSide(session);
  if ((!managerSide && session.role !== 'admin') || !session.companyId) {
    return { ok: false, error: 'forbidden' };
  }
  const companyId = session.companyId;
  const name = args.name.trim();
  const inn = args.inn?.trim() || null;
  if (!name || name.length > 300) return { ok: false, error: 'validation' };
  if (inn && !/^\d{10}(\d{2})?$/.test(inn)) return { ok: false, error: 'validation' };

  // Ключа может не быть (название из одних служебных слов) — тогда по названию
  // дубль не ищем: `nameKey: null` нашёл бы любую организацию без ключа.
  const nameKey = organizationNameKey(name);
  const twin = inn
    ? await prisma.organization.findUnique({
        where: { inn },
        select: { id: true, companyId: true },
      })
    : nameKey
      ? await prisma.organization.findFirst({
          where: { companyId, nameKey },
          select: { id: true, companyId: true },
        })
      : null;
  if (twin && twin.companyId !== companyId) return { ok: false, error: 'org_in_other_company' };
  if (twin) return { ok: false, error: 'org_exists', organizationId: twin.id };

  const org = await prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({
      data: { name, nameKey, inn, companyId },
      select: { id: true, name: true },
    });
    // Закрепление — менеджерскому контуру: без него рядовой менеджер вне
    // командного режима свою же организацию не увидел бы. Администратору
    // видна вся компания, закрепление ему ни к чему.
    if (managerSide) {
      await tx.organizationManager.create({
        data: {
          organizationId: created.id,
          userId: session.sub,
          isActive: true,
          assignedBy: session.sub,
        },
      });
    }
    await recordAudit(tx, {
      userId: session.sub,
      action: 'organization_created_manual',
      entity: 'organization',
      entityId: created.id,
      after: { name, inn, source: 'manager' },
    });
    return created;
  });
  return { ok: true, organizationId: org.id, name: org.name };
}
