import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requireAdmin } from '@/lib/auth/guard';
import { applyOrgRateOverride } from '@/lib/services/admin/orgRateOverride';

const payloadSchema = z.object({
  rate: z.union([z.number().gt(0).lt(1), z.null()]),
  reason: z.string().min(1).max(500),
});

/**
 * У-2 / решение Р-4: ставку комиссии по организации назначает **учебный центр**,
 * а не партнёр. Роль `partner` получает `403` при любом `partnerRole` — раньше
 * здесь стоял `requirePartnerAdmin`, и партнёр-администратор назначал ставку сам
 * себе (в истории `OrganizationCommissionRateChange` автором значился он же).
 *
 * Роут не удалён, а закрыт: `У-4` требует именно `403`, а у снесённого роута
 * ответ был бы `404`. Внутренним ролям он остаётся (`У-2`).
 *
 * `canPartnerAccessOrg` убран намеренно: предикат по определению возвращает
 * `false` для не-партнёрской сессии (`policy.ts`), так что с админской сессией
 * роут был бы мёртв. Скоуп админа — вся система (§4).
 *
 * Логика «найти партнёра по организации + выбрать set/clear» не дублируется:
 * её уже содержит `applyOrgRateOverride`, тот же сервис зовёт админский экран.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = requireAdmin(session);
  if (!admin.ok) return admin.response;

  const { orgId } = await ctx.params;

  const parseResult = payloadSchema.safeParse(await req.json().catch(() => null));
  if (!parseResult.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { rate, reason } = parseResult.data;

  // Роут принимает долю (0.085), сервис — проценты. Колонка Decimal(6,4),
  // поэтому обратное деление внутри сервиса не даёт «плавающих» копеек.
  const res = await applyOrgRateOverride(prisma, {
    organizationId: orgId,
    ...(rate === null ? { clear: true } : { ratePercent: rate * 100 }),
    reason,
    changedByUserId: session.sub,
  });

  if (!res.ok) {
    const status = res.error === 'not_found' ? 404 : 422;
    return NextResponse.json({ error: res.error }, { status });
  }
  return new NextResponse(null, { status: 204 });
}
