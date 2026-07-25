import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { isRateLimited } from '@/lib/rateLimit';
import { findByInn } from '@/lib/services/duplicates/findByInn';

const RATE = { windowMs: 60 * 1000, max: 30 };

/**
 * Антидубли по ИНН (этап 5 PR-2, ФТ-13.4) — staff-only: RBAC в сервисе
 * (canTriageClientRequests), клиентские роли получают 403 и НЕ узнают,
 * существует ли ИНН в базе. Rate-limit против перебора даже сотрудником.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (await isRateLimited(`duplicates-inn:${session.sub}`, RATE)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const inn = new URL(req.url).searchParams.get('inn') ?? '';
  const result = await findByInn(prisma, session, { inn });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === 'forbidden' ? 403 : 400 }
    );
  }
  return NextResponse.json({ duplicates: result.duplicates });
}
