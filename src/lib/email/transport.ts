/**
 * Email transport layer. Lazy-initialises the Resend SDK on first use so
 * builds and tests without `RESEND_API_KEY` don't touch the network or
 * require the env to be set at module-load time.
 *
 * Tests inject a fake transport via the `send()` argument; production code
 * falls back to `defaultTransport()`.
 */

import type { Resend } from 'resend';
import { log } from '@/lib/logging';
import { prisma } from '@/lib/db/prisma';
import { getSettingValue } from '@/lib/config/integrationSettings';

export type EmailTransport = {
  send(input: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<{ id: string | null }>;
};

// Кэш клиента + ключа, на котором он собран: если ключ сменили в UI, пересобираем.
let cachedClient: Resend | null = null;
let cachedForKey: string | null = null;

async function getResend(): Promise<Resend | null> {
  // Настройка из БД (панель /admin/integrations), иначе fallback на env.
  const apiKey = (await getSettingValue(prisma, 'email.resendApiKey'))?.trim();
  if (!apiKey) return null;
  if (cachedClient && cachedForKey === apiKey) return cachedClient;
  const mod = await import('resend');
  cachedClient = new mod.Resend(apiKey);
  cachedForKey = apiKey;
  return cachedClient;
}

export async function getEmailFrom(): Promise<string> {
  return (await getSettingValue(prisma, 'email.from'))?.trim() || 'no-reply@otsfera.ru';
}

export async function isEmailEnabled(): Promise<boolean> {
  const v = await getSettingValue(prisma, 'email.enabled');
  return v?.trim().toLowerCase() === 'true';
}

export function resetEmailTransportCache(): void {
  cachedClient = null;
  cachedForKey = null;
}

export async function defaultTransport(): Promise<EmailTransport | null> {
  const client = await getResend();
  if (!client) return null;
  return {
    async send(input) {
      const result = await client.emails.send({
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
      // Surface Resend-side failures (invalid recipient, rate limit, revoked
      // key). Without this they were swallowed and reported upstream as "sent"
      // with a null id, hiding systematic delivery failures from operators.
      if (result.error) {
        log.error('[email] Resend API error', { to: input.to, error: result.error });
      }
      return { id: result.data?.id ?? null };
    },
  };
}
