/**
 * Email transport layer. Lazy-initialises the Resend SDK on first use so
 * builds and tests without `RESEND_API_KEY` don't touch the network or
 * require the env to be set at module-load time.
 *
 * Tests inject a fake transport via the `send()` argument; production code
 * falls back to `defaultTransport()`.
 */

import type { Resend } from 'resend';

export type EmailTransport = {
  send(input: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<{ id: string | null }>;
};

let cachedClient: Resend | null = null;

async function getResend(): Promise<Resend | null> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  if (cachedClient) return cachedClient;
  const mod = await import('resend');
  cachedClient = new mod.Resend(apiKey);
  return cachedClient;
}

export function getEmailFrom(): string {
  return process.env.EMAIL_FROM?.trim() || 'no-reply@otsfera.ru';
}

export function isEmailEnabled(): boolean {
  return process.env.EMAIL_ENABLED?.trim().toLowerCase() === 'true';
}

export function resetEmailTransportCache(): void {
  cachedClient = null;
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
        console.error('[email] Resend API error', { to: input.to, error: result.error });
      }
      return { id: result.data?.id ?? null };
    },
  };
}
