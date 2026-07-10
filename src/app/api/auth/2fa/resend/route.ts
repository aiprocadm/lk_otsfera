import { NextRequest, NextResponse } from 'next/server';
import * as React from 'react';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { verifyTwoFactorPendingToken } from '@/lib/auth/jwt';
import { createTwoFactorChallenge } from '@/lib/services/auth/twoFactor';
import { recordAudit } from '@/lib/auth/audit';
import { isRateLimited } from '@/lib/rateLimit';
import { send } from '@/lib/email/send';
import {
  TwoFactorCodeTemplate,
  twoFactorCodeSubject,
  twoFactorCodeText
} from '@/lib/email/templates/two-factor-code';
import { log } from '@/lib/logging';

async function renderHtml(element: React.ReactElement): Promise<string> {
  const mod = await import('react-dom/server');
  return `<!DOCTYPE html>\n${mod.renderToStaticMarkup(element)}`;
}

// Переотправка email-кода 2FA. Двухключевой лимит по образцу reset-request:
// cooldown 30с между отправками + ≤3 переотправки на 10-минутное окно challenge.
export async function POST(req: NextRequest) {
  const disabled = notFoundIfDisabled('staff_2fa');
  if (disabled) return disabled;

  const pending = req.cookies.get('2fa_pending')?.value;
  if (!pending) {
    return NextResponse.json({ code: 'SESSION_EXPIRED', message: 'Login again' }, { status: 401 });
  }

  let sub: string;
  try {
    ({ sub } = await verifyTwoFactorPendingToken(pending));
  } catch {
    return NextResponse.json({ code: 'SESSION_EXPIRED', message: 'Login again' }, { status: 401 });
  }

  if (
    (await isRateLimited(`2fa-resend-cool:${sub}`, { windowMs: 30_000, max: 1 })) ||
    (await isRateLimited(`2fa-resend-total:${sub}`, { windowMs: 10 * 60_000, max: 3 }))
  ) {
    return NextResponse.json({ code: 'TOO_MANY_REQUESTS', message: 'Try again later' }, { status: 429 });
  }

  const user = await prisma.user.findUnique({
    where: { id: sub },
    select: { id: true, email: true, name: true, isActive: true }
  });
  if (!user || !user.isActive) {
    return NextResponse.json({ code: 'SESSION_EXPIRED', message: 'Login again' }, { status: 401 });
  }

  const { code } = await createTwoFactorChallenge(prisma, user.id);
  try {
    await send({
      to: user.email,
      subject: twoFactorCodeSubject(),
      html: await renderHtml(React.createElement(TwoFactorCodeTemplate, { name: user.name, code })),
      text: twoFactorCodeText({ name: user.name, code })
    });
  } catch (err) {
    await prisma.twoFactorChallenge.delete({ where: { userId: user.id } }).catch(() => {});
    log.error('[auth/2fa/resend] email send failed', {
      userId: user.id,
      error: err instanceof Error ? err.message : String(err)
    });
    return NextResponse.json({ code: 'EMAIL_SEND_FAILED', message: 'Failed to send the code' }, { status: 502 });
  }

  await recordAudit(prisma, {
    action: '2fa_code_sent',
    entity: 'auth_2fa',
    entityId: user.id,
    userId: user.id
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
