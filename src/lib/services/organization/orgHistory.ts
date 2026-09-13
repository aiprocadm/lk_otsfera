import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { auditActionLabel } from '@/lib/audit/labels';
import { isFeatureEnabled, type FeatureFlag } from '@/lib/featureFlags';
import { MESSENGER_LABELS, isMessengerChannel } from '@/lib/services/messengers/channels';
import { orgAccessibleForNotes } from '@/lib/services/organizationNotes/policy';

/**
 * Единая лента «История» карточки организации (`У-184`, этап 1 ТЗ
 * 12.09.2026, спека §3.8): журнал действий, заметки, диалоги мессенджеров,
 * звонки и входящие письма — в одной хронологии. Смены статусов заказов живут
 * в том же журнале действий, отдельной модели у них нет.
 *
 * Постраничность честная: с выбранным типом — точные `skip/take` по одному
 * источнику; «Все типы» — верх каждого источника (50) сливается по времени,
 * `total` = сумма счётчиков, подпись просит выбрать тип, чтобы листать глубже.
 * Источники под выключенными флагами не грузятся. Доступ — тот же, что у
 * заметок: сотрудники ЦО компании организации в своём охвате.
 */
const ORG_HISTORY_TYPES: ReadonlyArray<{
  key: 'audit' | 'note' | 'dialog' | 'call' | 'inbound';
  label: string;
  flag?: FeatureFlag;
}> = [
  { key: 'audit', label: 'Журнал действий' },
  { key: 'note', label: 'Заметки' },
  { key: 'dialog', label: 'Диалоги', flag: 'inbound_messaging' },
  { key: 'call', label: 'Звонки', flag: 'telephony_mango' },
  { key: 'inbound', label: 'Входящие письма', flag: 'inbound_messaging' },
];
export type OrgHistoryType = (typeof ORG_HISTORY_TYPES)[number]['key'];

export function isOrgHistoryType(value: string): value is OrgHistoryType {
  return ORG_HISTORY_TYPES.some((t) => t.key === value);
}

/** Типы, доступные при текущих флагах (для пилюль фильтра). */
export function orgHistoryTypesFor(flags: (flag: FeatureFlag) => boolean) {
  return ORG_HISTORY_TYPES.filter((t) => !t.flag || flags(t.flag)).map((t) => ({
    key: t.key,
    label: t.label,
  }));
}

export const ORG_HISTORY_PAGE = 20;
/** Сколько берём из каждого источника в режиме «Все типы». */
const ORG_HISTORY_TOP = 50;

export type OrgHistoryItem = {
  kind: OrgHistoryType;
  id: string;
  at: Date;
  title: string;
  subtitle: string | null;
  /** Кто: сотрудник (журнал, заметка) или собеседник (диалог, письмо). */
  actor: string | null;
};

export type OrgHistoryResult =
  | {
      ok: true;
      items: OrgHistoryItem[];
      total: number;
      /** `exact` — один тип, страницы точные; `top` — «Все типы», верх ленты. */
      mode: 'exact' | 'top';
    }
  | { ok: false; error: 'not_found' };

function snippet(text: string, max = 140): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function channelTitle(channel: string): string {
  return isMessengerChannel(channel) ? MESSENGER_LABELS[channel] : channel;
}

type Page = { skip: number; take: number };

async function auditSource(prisma: PrismaClient, orgId: string, page: Page) {
  const where = { entity: 'organization', entityId: orgId };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: { id: true, action: true, createdAt: true, user: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: page.skip,
      take: page.take,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return {
    total,
    items: rows.map<OrgHistoryItem>((r) => ({
      kind: 'audit',
      id: r.id,
      at: r.createdAt,
      title: auditActionLabel(r.action),
      subtitle: null,
      actor: r.user?.name ?? null,
    })),
  };
}

async function noteSource(prisma: PrismaClient, orgId: string, page: Page) {
  const where = { organizationId: orgId };
  const [rows, total] = await Promise.all([
    prisma.organizationNote.findMany({
      where,
      select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: page.skip,
      take: page.take,
    }),
    prisma.organizationNote.count({ where }),
  ]);
  return {
    total,
    items: rows.map<OrgHistoryItem>((r) => ({
      kind: 'note',
      id: r.id,
      at: r.createdAt,
      title: 'Заметка',
      subtitle: snippet(r.body),
      actor: r.author?.name ?? null,
    })),
  };
}

async function dialogSource(prisma: PrismaClient, orgId: string, page: Page) {
  const where = { organizationId: orgId };
  const [rows, total] = await Promise.all([
    prisma.messengerDialog.findMany({
      where,
      select: {
        id: true,
        channel: true,
        lastMessageAt: true,
        lastMessagePreview: true,
        peerDisplay: true,
        contact: { select: { name: true } },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      skip: page.skip,
      take: page.take,
    }),
    prisma.messengerDialog.count({ where }),
  ]);
  return {
    total,
    items: rows.map<OrgHistoryItem>((r) => ({
      kind: 'dialog',
      id: r.id,
      at: r.lastMessageAt,
      title: `Диалог в ${channelTitle(r.channel)}`,
      subtitle: r.lastMessagePreview ? snippet(r.lastMessagePreview) : null,
      actor: r.contact?.name ?? r.peerDisplay ?? null,
    })),
  };
}

async function callSource(prisma: PrismaClient, orgId: string, page: Page) {
  const where = { resolvedOrgId: orgId };
  const [rows, total] = await Promise.all([
    prisma.call.findMany({
      where,
      select: {
        id: true,
        direction: true,
        callerNumber: true,
        startedAt: true,
        createdAt: true,
        durationSec: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: page.skip,
      take: page.take,
    }),
    prisma.call.count({ where }),
  ]);
  return {
    total,
    items: rows.map<OrgHistoryItem>((r) => ({
      kind: 'call',
      id: r.id,
      at: r.startedAt ?? r.createdAt,
      title: r.direction === 'out' ? 'Исходящий звонок' : 'Входящий звонок',
      subtitle: r.durationSec !== null ? `${r.callerNumber} · ${r.durationSec} с` : r.callerNumber,
      actor: null,
    })),
  };
}

async function inboundSource(prisma: PrismaClient, orgId: string, page: Page) {
  const where = { resolvedOrgId: orgId };
  const [rows, total] = await Promise.all([
    prisma.inboundMessage.findMany({
      where,
      select: {
        id: true,
        channel: true,
        subject: true,
        body: true,
        createdAt: true,
        senderDisplay: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: page.skip,
      take: page.take,
    }),
    prisma.inboundMessage.count({ where }),
  ]);
  return {
    total,
    items: rows.map<OrgHistoryItem>((r) => ({
      kind: 'inbound',
      id: r.id,
      at: r.createdAt,
      title: r.subject?.trim() || snippet(r.body),
      subtitle: channelTitle(r.channel),
      actor: r.senderDisplay,
    })),
  };
}

const SOURCES: Record<
  OrgHistoryType,
  (
    prisma: PrismaClient,
    orgId: string,
    page: Page
  ) => Promise<{ items: OrgHistoryItem[]; total: number }>
> = {
  audit: auditSource,
  note: noteSource,
  dialog: dialogSource,
  call: callSource,
  inbound: inboundSource,
};

export async function listOrgHistory(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orgId: string; type?: OrgHistoryType | undefined; skip?: number | undefined }
): Promise<OrgHistoryResult> {
  const org = await orgAccessibleForNotes(prisma, session, args.orgId);
  if (!org) return { ok: false, error: 'not_found' };
  const skip = Math.max(0, Math.floor(args.skip ?? 0));
  const enabled = orgHistoryTypesFor(isFeatureEnabled).map((t) => t.key);

  if (args.type) {
    // Тип под выключенным флагом снаружи не предлагается; прямой адрес отвечает пусто.
    if (!enabled.includes(args.type)) return { ok: true, items: [], total: 0, mode: 'exact' };
    const { items, total } = await SOURCES[args.type](prisma, org.id, {
      skip,
      take: ORG_HISTORY_PAGE,
    });
    return { ok: true, items, total, mode: 'exact' };
  }

  const parts = await Promise.all(
    enabled.map((kind) => SOURCES[kind](prisma, org.id, { skip: 0, take: ORG_HISTORY_TOP }))
  );
  const merged = parts
    .flatMap((p) => p.items)
    .sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id));
  return {
    ok: true,
    items: merged.slice(skip, skip + ORG_HISTORY_PAGE),
    total: parts.reduce((sum, p) => sum + p.total, 0),
    mode: 'top',
  };
}
