import { prisma } from '@/lib/db/prisma';
import { linkByCode } from '@/lib/services/telegram/link';
import { sendTelegramMessage } from '@/lib/telegram/client';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const provided = req.headers.get('x-telegram-bot-api-secret-token');

  // 401 when secret is not configured or header doesn't match
  if (!secret || provided !== secret) {
    return new Response(null, { status: 401 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    // Malformed JSON — still return 200 so Telegram doesn't retry
    return new Response(null, { status: 200 });
  }

  // Extract message.text and message.chat.id safely
  const message = (update as Record<string, unknown>)?.message as
    | Record<string, unknown>
    | undefined;
  const text = typeof message?.text === 'string' ? message.text : null;
  const chatId =
    message?.chat != null
      ? String((message.chat as Record<string, unknown>).id)
      : null;

  // Only handle /start <code>
  if (text && chatId) {
    const startMatch = /^\/start\s+(\S+)/.exec(text);
    if (startMatch) {
      const code = startMatch[1]!;
      // Never log the code (§12 security rule). Wrap the whole handling so an
      // unexpected DB error can't turn into a 500 → Telegram retry-storm.
      try {
        const result = await linkByCode(prisma, { code, chatId });
        const reply = result.ok
          ? '✅ Уведомления привязаны к этому чату.'
          : 'Код недействителен или истёк.';
        // Best-effort — don't await failure propagation
        await sendTelegramMessage(chatId, reply).catch(() => {});
      } catch {
        // Swallow — always 200 below so Telegram doesn't retry.
      }
    }
  }

  // Always return 200 for well-formed updates (prevents Telegram retries)
  return new Response(null, { status: 200 });
}
