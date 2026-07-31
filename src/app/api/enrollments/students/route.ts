import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { canSubmitEnrollments } from '@/lib/services/enrollments/policy';
import { listOrgStudents } from '@/lib/services/organization/students';
import { recordPiiAccess } from '@/lib/pii/record';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Сотрудники организации для шага 2 мастера заявки (этап 2, ФТ-2.1): чекбоксы
 * «из сотрудников организации». Скоуп по ролям (defense-in-depth §4):
 * organization — только свои активные членства; partner — только свои
 * организации; manager/admin — любая. Тонкий роут: скоуп-гейт + listOrgStudents.
 */
async function canAccessOrg(session: SessionPayload, organizationId: string): Promise<boolean> {
  if (session.role === 'manager' || session.role === 'admin') return true;
  if (session.role === 'organization') {
    return (session.organizationMemberships ?? []).some(
      (m) => m.isActive && m.organizationId === organizationId
    );
  }
  // Сюда доходит только партнёр: гейт `canSubmitEnrollments` в GET выше пускает
  // ровно четыре роли, три из них разобраны. Отдельная проверка `role ===
  // 'partner'` и хвостовой `return false` были недостижимы (Ф3 программы
  // покрытия — недостижимое удаляем, а не «покрываем»).
  const org = await prisma.organization.findFirst({
    where: { id: organizationId, partnerId: session.partnerId ?? '__none__' },
    select: { id: true },
  });
  return !!org;
}

export async function GET(req: Request) {
  const disabled = notFoundIfDisabled('enrollment_requests');
  if (disabled) return disabled;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canSubmitEnrollments(session))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const organizationId = sp.get('organizationId')?.trim();
  if (!organizationId) return NextResponse.json({ error: 'validation' }, { status: 400 });

  if (!(await canAccessOrg(session, organizationId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { rows } = await listOrgStudents(prisma, {
    organizationId,
    search: sp.get('q') ?? undefined,
    take: 200,
  });

  // meta — только флаги/счётчики (PiiAccessMeta), без id и поисковых строк (§12).
  await recordPiiAccess(prisma, {
    session,
    context: 'enrollment_wizard_students',
    subjectIds: rows.map((r) => r.id),
    meta: { take: 200, hasQuery: sp.get('q') !== null },
  });

  return NextResponse.json({
    students: rows.map((r) => ({ id: r.id, name: r.name, email: r.email })),
  });
}
