import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';
import type { InboundEmailAdapter, InboundEmailDto, InboundEmailFetchResult } from './adapter';

export type ImapConfig = {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  tls: boolean;
};

/** Эффективный конфиг: настройки интеграций (БД после prime) → env fallback. */
export function readImapConfig(): ImapConfig {
  const rawPort = cachedIntegrationSetting('imap.port');
  const port = rawPort ? Number(rawPort) : undefined;
  const rawTls = (cachedIntegrationSetting('imap.tls') ?? '1').trim().toLowerCase();
  return {
    host: cachedIntegrationSetting('imap.host') ?? undefined,
    port: Number.isFinite(port) ? port : undefined,
    user: cachedIntegrationSetting('imap.user') ?? undefined,
    password: cachedIntegrationSetting('imap.password') ?? undefined,
    tls: rawTls !== '0' && rawTls !== 'false' && rawTls !== 'off',
  };
}

/** Максимум писем за прогон; хвост доберёт следующий poll (спека §3). */
const BATCH_LIMIT = 50;

/**
 * Курсор — "<uidValidity>:<lastSeenUid>" (спека 2026-07-22-imap-live-adapter §3).
 * Смена uidValidity (сервер пересоздал ящик) делает UID-ы несравнимыми —
 * курсор сбрасывается, чтение с UID 1.
 */
export function parseCursor(cursor: string | null, uidValidity: string): number {
  if (!cursor) return 0;
  const [gen, uid] = cursor.split(':');
  if (gen !== uidValidity) return 0;
  const parsed = Number(uid);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Текст письма: text → html без тегов → пустая строка (спека §4). */
export function bodyTextFrom(text: string | undefined, html: string | false | undefined): string {
  if (text?.trim()) return text.trim();
  if (typeof html === 'string' && html.trim()) {
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

/**
 * Live IMAP-адаптер (спека 2026-07-22-imap-live-adapter): соединение per-poll,
 * INBOX, выборка UID > курсора, парсинг mailparser'ом. Ошибки соединения/
 * конфига бросаются — джоба уходит в retry/DLQ (fail-loud: оператор включил
 * imap, молчание скрыло бы опечатку в хосте). Конфиг читается лениво при
 * каждом вызове (настройки редактируются в /admin/integrations).
 */
export class ImapInboundEmailAdapter implements InboundEmailAdapter {
  private readonly overrides: ImapConfig | null;

  constructor(config?: ImapConfig) {
    this.overrides = config ?? null;
  }

  protected get config(): ImapConfig {
    return this.overrides ?? readImapConfig();
  }

  async fetchNewMessages(cursor: string | null): Promise<InboundEmailFetchResult> {
    const { host, port, user, password, tls } = this.config;
    if (!host || !user || !password) {
      throw new Error(
        'imap config incomplete: host/user/password required (see /admin/integrations)'
      );
    }

    const client = new ImapFlow({
      host,
      // port не задан → стандартный по TLS (993 imaps / 143 imap)
      port: port ?? (tls ? 993 : 143),
      secure: tls,
      auth: { user, pass: password },
      logger: false,
    });

    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        // после getMailboxLock ящик гарантированно открыт (тип у imapflow — union с false до открытия)
        const mailbox = client.mailbox as Exclude<typeof client.mailbox, false>;
        const uidValidity = String(mailbox.uidValidity);
        const lastUid = parseCursor(cursor, uidValidity);

        // IMAP-квирк: диапазон "n:*" всегда включает письмо с максимальным
        // UID, даже если его UID < n — поэтому дополнительно фильтруем.
        const found = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
        const uids = (Array.isArray(found) ? found : [])
          .filter((uid) => uid > lastUid)
          .sort((a, b) => a - b)
          .slice(0, BATCH_LIMIT);

        const messages: InboundEmailDto[] = [];
        let maxUid = lastUid;
        for (const uid of uids) {
          const fetched = await client.fetchOne(String(uid), { source: true }, { uid: true });
          maxUid = uid;
          if (!fetched || !fetched.source) continue;
          const parsed = await simpleParser(fetched.source);
          const from = parsed.from?.value?.[0]?.address?.trim();
          // Письмо без адреса отправителя резолвить не во что — пропускаем,
          // курсор всё равно продвигается (иначе оно вечно блокирует хвост).
          if (!from) continue;
          messages.push({
            externalId: `${uidValidity}-${uid}`,
            from,
            subject: parsed.subject ?? undefined,
            text: bodyTextFrom(parsed.text, parsed.html),
          });
        }

        return {
          messages,
          cursor: maxUid > 0 ? `${uidValidity}:${maxUid}` : cursor,
        };
      } finally {
        lock.release();
      }
    } finally {
      // logout best-effort: ошибка закрытия не должна маскировать результат.
      await client.logout().catch(() => client.close());
    }
  }
}
