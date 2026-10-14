import React from 'react';
import Link from 'next/link';
import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { signStudentBridgeToken } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedStudentPortalUrl } from '@/lib/security/redirect';
import { recordAudit } from '@/lib/auth/audit';
import { log } from '@/lib/logging';
import { getStudentPortalConfig } from '@/lib/student/portal';

const bridgeCodeTtlSec = Number(process.env.STUDENT_BRIDGE_CODE_TTL_SEC ?? 60);

export default async function StudentRedirectPage() {
  const session = await getSession();
  if (!session) return null;
  // Defense-in-depth: this page mints a bridge token with role:'student'
  // hard-coded. Middleware also lets organization/manager/admin into /student
  // (shared cabinet entry), so the external SSO handoff itself must be
  // student-only — otherwise a non-student could obtain a student-scoped token.
  if (session.role !== 'student') {
    return <div className="p-6">Переход в кабинет слушателя доступен только обучающимся.</div>;
  }

  // `У-274` (`Д-53`): адрес — из «Настройки → Интеграции → Учебная площадка»
  // (переменная сервера — запасное). Пусто или заглушка из примера — не уводим
  // на несуществующий сайт, а честно говорим, что площадка не подключена.
  const portal = await getStudentPortalConfig(prisma);
  if (portal.status === 'not_connected') {
    return (
      <div className="mx-auto max-w-lg space-y-3 p-6">
        <h1 className="text-lg font-semibold text-[#111111]">Учебная площадка ещё не подключена</h1>
        <p className="text-sm text-gray-600">
          Учебная площадка ещё не подключена — обратитесь к менеджеру.
        </p>
        <Link href="/student" className="text-sm text-[#F97316] hover:underline">
          ← В кабинет слушателя
        </Link>
      </div>
    );
  }
  const { redirectUrl: externalUrl, allowlist: studentPortalAllowlist } = portal;

  let url: URL;
  try {
    url = assertAllowedStudentPortalUrl(externalUrl, { allowlist: studentPortalAllowlist });
  } catch (error) {
    const parsed = URL.canParse(externalUrl) ? new URL(externalUrl) : null;
    log.error('Blocked student portal redirect URL', {
      reason: error instanceof Error ? error.message : 'Unknown error',
      protocol: parsed?.protocol,
      hostname: parsed?.hostname,
    });

    return (
      <div className="p-6">Не удалось выполнить безопасный переход. Обратитесь в поддержку.</div>
    );
  }

  const {
    token: bridge,
    jti,
    iat,
  } = await signStudentBridgeToken({
    sub: session.sub,
    role: 'student',
    // exactOptionalPropertyTypes: StudentBridgePayload различает «ключа нет» и «ключ = undefined».
    ...(session.organizationId !== undefined ? { organizationId: session.organizationId } : {}),
    ...(session.email !== undefined ? { email: session.email } : {}),
    ...(session.name !== undefined ? { name: session.name } : {}),
    ...(session.externalStudentId !== undefined
      ? { externalStudentId: session.externalStudentId }
      : {}),
  });

  const code = randomUUID();
  // Clamp the one-time code lifetime to [10, 300]s. Guards an operator setting
  // STUDENT_BRIDGE_CODE_TTL_SEC to 0/negative/NaN (→ floor) or an excessively
  // long window (→ ceiling) that would leave a live grant + JWT redeemable for
  // hours.
  const codeTtlSec = Number.isFinite(bridgeCodeTtlSec)
    ? Math.min(300, Math.max(10, bridgeCodeTtlSec))
    : 60;
  // eslint-disable-next-line react-hooks/purity -- server component, Date.now() is safe here
  const expiresAt = new Date(Date.now() + codeTtlSec * 1000);

  await prisma.$transaction(async (tx) => {
    await recordAudit(tx, {
      action: 'STUDENT_BRIDGE_TOKEN_ISSUED',
      entity: 'student_bridge',
      entityId: jti,
      userId: session.sub,
      after: {
        iat,
        organizationId: session.organizationId,
        externalStudentId: session.externalStudentId,
      },
    });
    await tx.studentBridgeGrant.create({
      data: {
        code,
        jti,
        token: bridge,
        userId: session.sub,
        expiresAt,
      },
    });
    await recordAudit(tx, {
      action: 'STUDENT_BRIDGE_CODE_ISSUED',
      entity: 'student_bridge',
      entityId: jti,
      userId: session.sub,
      // SECURITY: never log the one-time bridge code (CLAUDE.md §12). The jti in
      // `entityId` already correlates the grant for forensics.
      after: { expiresAt: expiresAt.toISOString() },
    });
  });

  url.searchParams.set('code', code);

  redirect(url.toString());
}
