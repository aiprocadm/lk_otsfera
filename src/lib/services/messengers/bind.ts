import type { ContactChannelType, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getCompanyTeamVisibility, isOrgInScope, isManagerLeader } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';
import { captureChannel } from '@/lib/services/manager/contacts';
import { isDialogInScope } from './scope';

export type BindDialogArgs = {
  dialogId: string;
  organizationId: string;
  contactId?: string | undefined;
};

export type BindDialogResult = { ok: true } | { ok: false; error: 'forbidden' | 'not_found' };

/**
 * Привязка диалога к организации (и, по желанию, к контакту) — спека
 * 2026-09-12 §4 `bind.ts`. Гейты те же, что у `bindInboundMessage`: диалог в
 * скоупе, организация своей компании, при выключенной командной видимости —
 * из закреплённых (руководителя сужение не касается), контакт своей компании
 * и той же организации.
 *
 * Побочные эффекты — ради того, чтобы следующий раз всё сложилось само:
 * learn-on-link пишет адрес мессенджера в каналы контакта (резолвер узнает
 * собеседника), а непривязанные письма того же собеседника во «Входящих в
 * работу» получают ту же привязку — очередь триажа очищается одним действием.
 * Привязка без контакта сбрасывает прежний контакт: явное решение сотрудника
 * важнее автоматики.
 */
export async function bindDialog(
  prisma: PrismaClient,
  session: SessionPayload,
  args: BindDialogArgs
): Promise<BindDialogResult> {
  const dialog = await prisma.messengerDialog.findUnique({
    where: { id: args.dialogId },
    select: { id: true, channel: true, peerRef: true, companyId: true },
  });
  if (!dialog) return { ok: false, error: 'not_found' };
  if (!isDialogInScope(session, dialog)) return { ok: false, error: 'forbidden' };

  const org = await prisma.organization.findUnique({
    where: { id: args.organizationId },
    select: { id: true, companyId: true },
  });
  if (!org) return { ok: false, error: 'not_found' };

  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  // C8: компания — жёсткая граница в обоих режимах.
  if (!session.companyId || org.companyId !== session.companyId) {
    return { ok: false, error: 'forbidden' };
  }
  if (!teamMode && !isManagerLeader(session) && !isOrgInScope(session, args.organizationId)) {
    return { ok: false, error: 'forbidden' };
  }

  let contactId: string | null = null;
  if (args.contactId) {
    const contact = await prisma.contact.findUnique({
      where: { id: args.contactId },
      select: { id: true, companyId: true, organizationId: true },
    });
    if (!contact || contact.companyId !== session.companyId) {
      return { ok: false, error: 'forbidden' };
    }
    if (contact.organizationId && contact.organizationId !== args.organizationId) {
      return { ok: false, error: 'forbidden' };
    }
    contactId = contact.id;
  }

  const now = new Date();
  await prisma.messengerDialog.update({
    where: { id: dialog.id },
    data: { companyId: org.companyId, organizationId: args.organizationId, contactId },
  });

  if (contactId) {
    await captureChannel(prisma, {
      contactId,
      companyId: session.companyId,
      type: dialog.channel as ContactChannelType,
      value: dialog.peerRef,
    });
  }

  await prisma.inboundMessage.updateMany({
    where: { channel: dialog.channel, senderRef: dialog.peerRef, status: 'unresolved' },
    data: {
      status: 'bound',
      resolvedOrgId: args.organizationId,
      companyId: org.companyId,
      contactId,
      boundAt: now,
    },
  });

  await recordAudit(prisma, {
    action: 'messenger_dialog_bound',
    entity: 'messenger_dialog',
    entityId: dialog.id,
    userId: session.sub,
    after: { organizationId: args.organizationId, contactId },
  });

  return { ok: true };
}
