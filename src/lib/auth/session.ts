import { cookies } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { primeFeatureFlagCache } from '@/lib/config/featureFlagStore';
import { loadManagedOrgIds } from './buildSessionClaims';
import { verifyToken } from './jwt';

/** Срок жизни session-cookie = сроку жизни JWT '7d' в jwt.ts (signToken). */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export async function getSession() {
  // `У-65`/`У-66`: единая точка обновления снимка значений флагов. Сессию
  // читает каждая защищённая страница, роут и server-action, а сам прайм
  // ходит в базу не чаще раза в 30 секунд (TTL снапшота). Отдельного списка
  // «где праймить» не заводим — он неизбежно отстал бы от читателей флагов.
  // Middleware сюда не заходит (у него свой `jwtVerify`), поэтому edge-среда
  // остаётся на переменных окружения — см. `isRouteGatedFlag`.
  await primeFeatureFlagCache(prisma);
  const token = (await cookies()).get('session')?.value;
  if (!token) return null;
  try {
    const payload = await verifyToken(token);
    if (!payload.sub) return null;
    // Partner.isActive is intentionally not checked here — partner deactivation
    // is enforced via TTL on the next JWT issue, see admin partners flow.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { isActive: true, sessionVersion: true },
    });
    if (!user || !user.isActive) return null;
    // Этап 9 (ФТ-11.2): ревокация сессий. Токены, выданные до появления клейма,
    // читаются как версия 0 — они остаются валидными, пока версию не увеличили.
    if ((payload.sessionVersion ?? 0) !== user.sessionVersion) return null;
    // `У-275` (`Д-50`): список закреплённых организаций в токене — снимок на
    // момент входа. Назначенная администратором организация не появлялась у
    // менеджера до повторного входа (до 7 дней жизни токена). Поэтому для
    // менеджерского контура список читается свежим на каждом запросе —
    // один индексный запрос, тот же, что при входе. Снятие назначения так же
    // действует сразу.
    if (payload.role === 'manager' || payload.role === 'leader') {
      return {
        ...payload,
        managedOrgIds: await loadManagedOrgIds(prisma, payload.sub, payload.companyId ?? null),
      };
    }
    return payload;
  } catch {
    return null;
  }
}
