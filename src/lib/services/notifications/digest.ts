import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { log } from '@/lib/logging';
import { fmtDateTime } from '@/lib/format';
import { getTemplateOverride, applyOverride } from '@/lib/email/templateOverrides';
import { sendDailyDigestEmail, sendNotificationEmail } from '@/lib/email/send';
import type { DailyDigestItem } from '@/lib/email/templates/daily-digest';
import { urgentNotificationTypes } from '@/lib/notifications/registry';
import { notificationRoute } from '@/lib/notifications/routes';
import { getAppBaseUrl } from '@/lib/notifications/shared';

/**
 * Дневной дайджест уведомлений (этап 5 ТЗ 12.09.2026, `У-230`, решение `Р-Э5-6`).
 *
 * Не «отложить письмо», а «вычесть канал и собрать»: у пользователя с
 * `digestEnabled` канал `email` вычитается из веера несрочных типов в момент
 * доставки (`channels/preferences.ts`), а запись в кабинете остаётся — она и
 * есть содержимое дайджеста. Ежечасный воркер выбирает тех, у кого час совпал,
 * **атомарно занимает** их (`updateMany … where digestLastSentAt < порог` →
 * `count === 0` → пропуск; канон claim из `У-225`), собирает записи за окно с
 * прошлой отправки (или 24 ч), исключая срочные типы, и шлёт одно письмо.
 * Пусто — не шлёт, но отметку сдвигает: иначе завтра собрались бы двое суток.
 *
 * Дайджест — только заказчику и партнёру (`В-5-2`): галочка видна им, сервис
 * отвергает включение у прочих ролей. Час по умолчанию — 09:00 по Москве (`В-5-3`).
 */

const DIGEST_ROLES: ReadonlySet<string> = new Set(['organization', 'partner']);
export const DIGEST_MAX_ITEMS = 50;
/** Минимальный зазор между двумя дайджестами: защита от двойной отправки в один час. */
export const DIGEST_MIN_GAP_MS = 20 * 60 * 60 * 1000;
/** Окно первого дайджеста, когда отправки ещё не было. */
const DIGEST_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Час суток по Москве (UTC+3 без перевода часов). */
export function moscowHour(now: Date): number {
  return new Date(now.getTime() + MSK_OFFSET_MS).getUTCHours();
}

export type DigestSettings = {
  /** Роль может включить дайджест (заказчик, партнёр). */
  eligible: boolean;
  enabled: boolean;
  hourMsk: number;
  lastSentAt: Date | null;
};

type DigestErrorCode = 'forbidden' | 'invalid_hour';

export async function getDigestSettings(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; settings: DigestSettings }> {
  const eligible = DIGEST_ROLES.has(session.role);
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { digestEnabled: true, digestHourMsk: true, digestLastSentAt: true },
  });
  return {
    ok: true,
    settings: {
      eligible,
      enabled: eligible && (user?.digestEnabled ?? false),
      hourMsk: user?.digestHourMsk ?? 9,
      lastSentAt: user?.digestLastSentAt ?? null,
    },
  };
}

export async function updateDigestSettings(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { enabled: boolean; hourMsk: number }
): Promise<{ ok: true; settings: DigestSettings } | { ok: false; error: DigestErrorCode }> {
  // Гард на сервере, а не только в скрытой галочке (§4): сотрудникам и
  // слушателю дайджест не положен (`В-5-2`).
  if (!DIGEST_ROLES.has(session.role)) return { ok: false, error: 'forbidden' };
  if (!Number.isInteger(args.hourMsk) || args.hourMsk < 0 || args.hourMsk > 23) {
    return { ok: false, error: 'invalid_hour' };
  }
  const before = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { digestEnabled: true, digestHourMsk: true },
  });
  const updated = await prisma.user.update({
    where: { id: session.sub },
    data: { digestEnabled: args.enabled, digestHourMsk: args.hourMsk },
    select: { digestEnabled: true, digestHourMsk: true, digestLastSentAt: true },
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'notification_digest_changed',
    entity: 'user',
    entityId: session.sub,
    ...(before ? { before: { enabled: before.digestEnabled, hourMsk: before.digestHourMsk } } : {}),
    after: { enabled: updated.digestEnabled, hourMsk: updated.digestHourMsk },
  });
  return {
    ok: true,
    settings: {
      eligible: true,
      enabled: updated.digestEnabled,
      hourMsk: updated.digestHourMsk,
      lastSentAt: updated.digestLastSentAt,
    },
  };
}

export type DigestRunSummary = {
  hourMsk: number;
  /** Флаг выключен — прогон пропущен целиком. */
  disabled: boolean;
  candidates: number;
  sent: number;
  /** Событий не было — письмо не ушло, отметка сдвинута. */
  empty: number;
  /** Захват не удался (параллельный прогон) или письмо не отправлено. */
  skipped: number;
};

type Candidate = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  organizationId: string | null;
  digestLastSentAt: Date | null;
};

async function collectItems(
  prisma: PrismaClient,
  user: Candidate,
  since: Date,
  urgent: string[]
): Promise<{ items: DailyDigestItem[]; total: number }> {
  const where = {
    userId: user.id,
    type: { notIn: urgent },
    OR: [{ lastOccurredAt: { gt: since } }, { lastOccurredAt: null, createdAt: { gt: since } }],
  };
  const [rows, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [
        { lastOccurredAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: DIGEST_MAX_ITEMS,
      select: {
        type: true,
        title: true,
        body: true,
        meta: true,
        dedupCount: true,
        createdAt: true,
        lastOccurredAt: true,
      },
    }),
    prisma.notification.count({ where }),
  ]);
  const base = getAppBaseUrl();
  const items = rows.map((r) => {
    const route = notificationRoute(r.type, r.meta, user.role);
    return {
      title: r.title,
      body: r.body,
      at: fmtDateTime(r.lastOccurredAt ?? r.createdAt),
      times: r.dedupCount,
      url: route ? `${base}${route}` : null,
    };
  });
  return { items, total };
}

function itemsAsText(items: DailyDigestItem[]): string {
  return items
    .map(
      (i) =>
        `• ${i.title}${i.times > 1 ? ` ×${i.times}` : ''} — ${i.at}${i.url ? `\n  ${i.url}` : ''}`
    )
    .join('\n');
}

/** Компания-продавец для переопределённого текста (`У-128`): у заказчика — компания его организации. */
async function sellerCompanyId(prisma: PrismaClient, user: Candidate): Promise<string | null> {
  if (user.role !== 'organization' || !user.organizationId) return null;
  const org = await prisma.organization.findUnique({
    where: { id: user.organizationId },
    select: { companyId: true },
  });
  return org?.companyId ?? null;
}

/**
 * Один прогон воркера: все, у кого час совпал и прошло ≥ 20 часов с прошлой
 * отправки. Каждый пользователь — свой try/catch: сбой одного письма не
 * останавливает остальных (§3, degrade gracefully).
 */
export async function runNotificationDigest(
  prisma: PrismaClient,
  now: Date = new Date()
): Promise<DigestRunSummary> {
  const hourMsk = moscowHour(now);
  const summary: DigestRunSummary = {
    hourMsk,
    disabled: false,
    candidates: 0,
    sent: 0,
    empty: 0,
    skipped: 0,
  };
  // `Р-Э5-8`: дайджест — новое этапа, под флагом; выключен — ничего не делаем.
  if (!isFeatureEnabled('notification_center')) return { ...summary, disabled: true };

  const threshold = new Date(now.getTime() - DIGEST_MIN_GAP_MS);
  const due = {
    OR: [{ digestLastSentAt: null }, { digestLastSentAt: { lt: threshold } }],
  };
  const candidates: Candidate[] = await prisma.user.findMany({
    where: {
      isActive: true,
      digestEnabled: true,
      digestHourMsk: hourMsk,
      role: { in: ['organization', 'partner'] },
      ...due,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      organizationId: true,
      digestLastSentAt: true,
    },
  });
  summary.candidates = candidates.length;
  const urgent = urgentNotificationTypes();

  for (const user of candidates) {
    try {
      // Атомарный захват: второй прогон в тот же час увидит count === 0.
      const claimed = await prisma.user.updateMany({
        where: { id: user.id, ...due },
        data: { digestLastSentAt: now },
      });
      if (claimed.count === 0) {
        summary.skipped += 1;
        continue;
      }
      const since = user.digestLastSentAt ?? new Date(now.getTime() - DIGEST_LOOKBACK_MS);
      const { items, total } = await collectItems(prisma, user, since, urgent);
      if (items.length === 0) {
        summary.empty += 1;
        continue;
      }
      const props = {
        recipientName: user.name || 'коллега',
        period: `с ${fmtDateTime(since)} по ${fmtDateTime(now)}`,
        count: total,
        items,
        moreCount: Math.max(0, total - items.length),
        cabinetUrl: `${getAppBaseUrl()}/${user.role}/notifications`,
        itemsText: itemsAsText(items),
      };
      // `У-128`: свой текст письма, если учебный центр его переопределил.
      const override = await getTemplateOverride(
        prisma,
        'dailyDigest',
        await sellerCompanyId(prisma, user)
      );
      const result = override
        ? await (async () => {
            const { subject, text } = applyOverride('dailyDigest', override, props);
            return sendNotificationEmail({
              to: user.email,
              recipientName: props.recipientName,
              title: subject,
              body: text,
              url: props.cabinetUrl,
            });
          })()
        : await sendDailyDigestEmail({ to: user.email, ...props });
      if (result.status === 'sent') summary.sent += 1;
      else {
        summary.skipped += 1;
        log.warn('[digest] письмо не отправлено', { userId: user.id, reason: result.reason });
      }
    } catch (err) {
      summary.skipped += 1;
      log.error('[digest] сбой у получателя', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}
