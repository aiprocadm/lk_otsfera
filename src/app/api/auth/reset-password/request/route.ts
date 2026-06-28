import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { createInviteToken } from '@/lib/auth/passwordReset';
import { send } from '@/lib/email/send';
import { PasswordResetTemplate, passwordResetSubject, passwordResetText } from '@/lib/email/templates/password-reset';
import * as React from 'react';

// Dynamic import keeps react-dom/server out of the static module graph.
async function renderHtml(element: React.ReactElement): Promise<string> {
  const mod = await import('react-dom/server');
  return `<!DOCTYPE html>\n${mod.renderToStaticMarkup(element)}`;
}

const RequestSchema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: true });
  }

  const { email } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  if (user && user.isActive) {
    const { token } = await createInviteToken(prisma, user.id, undefined, 'reset');
    const baseUrl = process.env.APP_URL?.trim() || 'https://lk.otsfera.ru';
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    const props = { name: user.name, resetUrl };
    // Best-effort: an email-transport failure must not surface to the caller. A
    // 500 here is only reachable when the user exists + is active, so letting it
    // propagate would leak account existence and break the uniform { ok: true }
    // enumeration guard returned below.
    try {
      await send({
        to: email,
        subject: passwordResetSubject(),
        html: await renderHtml(React.createElement(PasswordResetTemplate, props)),
        text: passwordResetText(props),
      });
    } catch (err) {
      console.error('[reset-password/request] email send failed', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ ok: true });
}
