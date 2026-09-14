import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { MESSENGER_LABELS } from '@/lib/services/messengers/channels';
import { getDialog, markDialogRead } from '@/lib/services/messengers/get';
import { listAssignableStaff } from '@/lib/services/messengers/assign';
import { listOrganizations } from '@/lib/services/manager/organizations';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { DialogThread } from '@/components/manager/messengers/dialog-thread';
import { DialogReplyForm } from '@/components/manager/messengers/dialog-reply-form';
import { DialogAttachmentForm } from '@/components/manager/messengers/dialog-attachment-form';
import { DialogBindForm } from '@/components/manager/messengers/dialog-bind-form';
import { DialogStatusButton } from '@/components/manager/messengers/dialog-status-button';
import { DialogStatusBadge } from '@/components/manager/messengers/dialog-status-badge';
import { DialogAssigneePanel } from '@/components/manager/messengers/dialog-assignee-panel';
import { SourceIntakeActions } from '@/components/intake/source-intake-actions';
import { Badge } from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

/**
 * Карточка диалога (спека 2026-09-12 §5.2): лента, ответ, привязка,
 * действия «Создать лид» / «Задача» по последнему входящему письму.
 * Чужой или несуществующий диалог — 404 (сервис не различает их наружу).
 */
export default async function ManagerMessengerDialogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isFeatureEnabled('inbound_messaging')) notFound();
  const session = await requireManager();
  const { id } = await params;

  const result = await getDialog(prisma, session, id);
  if (!result.ok) notFound();
  const dialog = result.dialog;

  // Открыл — значит прочитал; список организаций нужен только ничьему диалогу.
  const [, organizations, staff] = await Promise.all([
    markDialogRead(prisma, session, dialog.id),
    dialog.bound ? Promise.resolve([]) : listOrganizations(prisma, session),
    listAssignableStaff(prisma, session),
  ]);

  const channelLabel = MESSENGER_LABELS[dialog.channel];
  const crumbs = buildCabinetBreadcrumbs('manager', '/manager/messengers', [
    { label: dialog.peerLabel },
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={crumbs}
        title={dialog.peerLabel}
        subtitle={`${channelLabel} · ${
          dialog.organization
            ? dialog.organization.name
            : dialog.bound
              ? 'Организация не указана'
              : 'Диалог ещё не привязан к организации'
        }`}
        action={
          <div className="flex items-center gap-2">
            <DialogStatusBadge status={dialog.status} overdue={dialog.overdue} />
            <DialogStatusButton dialogId={dialog.id} status={dialog.status} />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
          <DialogThread
            dialogId={dialog.id}
            messages={dialog.messages}
            hiddenCount={dialog.hiddenCount}
          />
          {dialog.channelAvailable ? (
            <div className="space-y-2">
              <DialogReplyForm dialogId={dialog.id} />
              {dialog.attachmentsAllowed ? (
                <DialogAttachmentForm dialogId={dialog.id} limitMb={dialog.attachmentLimitMb} />
              ) : (
                <p className="text-xs text-gray-500">
                  Файлы в этом канале отправить нельзя — он принимает только текст.
                </p>
              )}
            </div>
          ) : (
            <p role="status" className="text-sm text-gray-500">
              Мессенджер {channelLabel} сейчас не подключён — ответить отсюда нельзя. Подключение
              настраивает администратор в разделе «Настройки → Интеграции».
            </p>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <DialogAssigneePanel dialogId={dialog.id} assignee={dialog.assignee} staff={staff} />
          </div>

          <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-700">Кто это</h2>
            <p className="text-sm text-gray-600">
              {channelLabel}: <span className="text-gray-800">{dialog.peerRef}</span>
            </p>
            {dialog.contact && (
              <p className="text-sm text-gray-600">
                Контакт: <span className="text-gray-800">{dialog.contact.name}</span>
              </p>
            )}
            {dialog.user && (
              <p className="text-sm text-gray-600">
                Пользователь кабинета:{' '}
                <span className="text-gray-800">{dialog.user.name ?? 'без имени'}</span>
              </p>
            )}
            {dialog.organization ? (
              <Link
                href={`/manager/organizations/${dialog.organization.id}`}
                className="inline-block text-sm text-orange-600 hover:underline"
              >
                Открыть карточку организации →
              </Link>
            ) : dialog.bound ? (
              <Badge tone="neutral">Организация не указана</Badge>
            ) : (
              <div className="space-y-2">
                <Badge tone="warning">Не привязан</Badge>
                <p className="text-xs text-gray-500">
                  Привяжите диалог к организации — письма этого собеседника уйдут из очереди
                  «Входящие в работу», а следующие сообщения распознаются сами.
                </p>
                <DialogBindForm dialogId={dialog.id} organizations={organizations} />
              </div>
            )}
          </div>

          {dialog.lastInbound && (
            <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-gray-700">По последнему сообщению</h2>
              <SourceIntakeActions
                kind="inbound"
                sourceId={dialog.lastInbound.inboundMessageId}
                leadPrefill={{
                  companyName: dialog.organization?.name ?? dialog.peerLabel,
                  contactName: dialog.peerLabel,
                  contactPhone: dialog.channel === 'whatsapp' ? dialog.peerRef : '',
                  contactEmail: '',
                  subject: `Диалог в ${channelLabel}`,
                }}
                taskTitle={`${channelLabel}: ${dialog.lastInbound.body.slice(0, 80)}`}
                organizationId={dialog.organization?.id ?? null}
                currentUserId={session.sub}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
