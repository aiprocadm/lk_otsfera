import type { PrismaClient } from '@prisma/client';
import { log } from '@/lib/logging';
import { dispatchToRecipient } from './channels/dispatch';
import { CHANNEL_RECIPIENT_SELECT, type ChannelPayload } from './channels/types';
import { allowedChannels } from './routing';
import { getAppBaseUrl } from './shared';
import { recordNotification } from './core';

/**
 * `partner_material_published` (`У-237`): компания опубликовала материал —
 * всем пользователям партнёров, у которых есть организации этой компании.
 * Пользователь партнёра с `assignedOrgIds` получает письмо только если хотя бы
 * одна его организация принадлежит компании-издателю — тот же скоуп, что у
 * списка материалов (видимость = адресация).
 *
 * Единая точка записи (`recordNotification`, дедуп по материалу) и правила
 * компании-издателя (`allowedChannels`, один раз на рассылку) — как у
 * остальных рассылок клиентского контура.
 */
export async function notifyPartnerMaterialPublished(
  db: PrismaClient,
  materialId: string
): Promise<{ recipientsNotified: number }> {
  try {
    const material = await db.partnerMaterial.findUnique({
      where: { id: materialId },
      select: {
        id: true,
        title: true,
        companyId: true,
        company: { select: { name: true } },
      },
    });
    if (!material) return { recipientsNotified: 0 };

    const orgs = await db.organization.findMany({
      where: { companyId: material.companyId, partnerId: { not: null } },
      select: { id: true, partnerId: true },
    });
    const orgIdsByPartner = new Map<string, Set<string>>();
    for (const o of orgs) {
      // `partnerId: { not: null }` в where — ветка недостижима.
      /* v8 ignore next */
      if (!o.partnerId) continue;
      const set = orgIdsByPartner.get(o.partnerId) ?? new Set<string>();
      set.add(o.id);
      orgIdsByPartner.set(o.partnerId, set);
    }
    if (orgIdsByPartner.size === 0) return { recipientsNotified: 0 };

    const members = await db.partnerUser.findMany({
      where: {
        partnerId: { in: Array.from(orgIdsByPartner.keys()) },
        isActive: true,
        user: { isActive: true },
      },
      select: { partnerId: true, assignedOrgIds: true, user: { select: CHANNEL_RECIPIENT_SELECT } },
    });

    const title = 'Новый материал для партнёров';
    const body = `${material.company.name}: «${material.title}».`;
    const url = `${getAppBaseUrl()}/partner/materials`;
    const meta = { materialId: material.id, companyName: material.company.name };

    // `У-127`: правила компании-издателя, один раз на рассылку.
    const routed = await allowedChannels(db, {
      eventType: 'partner_material_published',
      audience: 'partner',
      companyId: material.companyId,
    });

    let recipientsNotified = 0;
    const seen = new Set<string>();
    for (const member of members) {
      if (seen.has(member.user.id)) continue;
      const orgIds = orgIdsByPartner.get(member.partnerId);
      /* v8 ignore next -- партнёр из `in` всегда есть в карте */
      if (!orgIds) continue;
      if (member.assignedOrgIds.length > 0 && !member.assignedOrgIds.some((id) => orgIds.has(id))) {
        continue;
      }
      seen.add(member.user.id);

      const { row, deduped } = await recordNotification(db, {
        userId: member.user.id,
        partnerId: member.partnerId,
        type: 'partner_material_published',
        title,
        body,
        meta,
        entityId: material.id,
      });
      recipientsNotified += 1;
      if (deduped) continue;

      const payload: ChannelPayload = {
        type: 'partner_material_published',
        title,
        body,
        url,
        email: {
          template: 'notification',
          props: { recipientName: member.user.name || 'партнёр', title, body, url },
        },
        companyId: material.companyId,
      };
      await dispatchToRecipient(member.user, payload, {
        dedupKey: row.id,
        ...(routed ? { channels: routed } : {}),
      });
    }
    return { recipientsNotified };
  } catch (err) {
    log.warn('[notifications/partnerMaterials] publish notify failed', {
      materialId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { recipientsNotified: 0 };
  }
}
