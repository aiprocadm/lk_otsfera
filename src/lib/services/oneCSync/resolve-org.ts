import type { PrismaClient } from '@prisma/client';

export type OrgRef = { externalId?: string | null; inn?: string | null };
export async function resolveOrganizationRef(db: PrismaClient, ref: OrgRef) {
  if (ref.externalId) {
    const byExt = await db.organization.findFirst({
      where: { externalId: ref.externalId },
      select: { id: true, partnerId: true, companyId: true, externalId: true },
    });
    if (byExt) return byExt;
  }
  if (ref.inn) {
    const byInn = await db.organization.findFirst({
      where: { inn: ref.inn },
      select: { id: true, partnerId: true, companyId: true, externalId: true },
    });
    if (byInn) {
      if (ref.externalId && !byInn.externalId) {
        await db.organization.update({
          where: { id: byInn.id },
          data: { externalId: ref.externalId },
        });
        return { ...byInn, externalId: ref.externalId };
      }
      return byInn;
    }
  }
  return null;
}
