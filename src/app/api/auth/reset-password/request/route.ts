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
    const resetUrl = `${process.env.APP_URL ?? ''}/reset-password?token=${token}`;

    const props = { name: user.name, resetUrl };
    await send({
      to: email,
      subject: passwordResetSubject(),
      html: await renderHtml(React.createElement(PasswordResetTemplate, props)),
      text: passwordResetText(props),
    });
  }

  return NextResponse.json({ ok: true });
}
