import type { PrismaClient } from '@prisma/client';
import { isDadataEnabled } from '@/lib/services/admin/integrations';
import { suggestParty } from '@/lib/services/dadata/suggestParty';
import { log } from '@/lib/logging';
import { counterpartyKey } from './counterparty-key';

/**
 * Обогащение ИНН по названию через ЕГРЮЛ (`У-85`, решение `Р-11`).
 *
 * Правило приёмки нарочно строгое: ИНН принимается, только если DaData вернула
 * **ровно одну действующую** организацию, чей ключ названия (`У-83`) совпал с
 * ключом контрагента из выписки. Организационно-правовая форма может
 * отличаться («Ромашка ООО» ≈ «Ромашка АО» — решение `Р-11`), а вот две записи
 * с одинаковым ключом, ликвидированная организация или «похожее, но другое»
 * название ИНН не дают: платежи ушли бы к чужой организации, и разбирать это
 * пришлось бы вручную.
 *
 * Запрос — один на контрагента (не на строку файла): результат, включая
 * «не нашлось», кладётся в кэш на 15 минут, поэтому применение импорта
 * переиспользует ответы предпросмотра.
 */
export type DadataInnHit = { inn: string; egrulName: string };

export type EnrichResult = {
  byKey: Map<string, DadataInnHit>;
  /** Ходили ли в ЕГРЮЛ вообще (для диагностики `У-92`). */
  used: boolean;
  reason?: 'disabled' | 'failed' | 'nothing_to_ask';
};

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; hit: DadataInnHit | null }>();

/** Сброс кэша — для тестов и ручного «повторить поиск». */
export function resetDadataInnCache(): void {
  cache.clear();
}

/** Действующей считаем только `ACTIVE`; отсутствие статуса — не повод рисковать. */
function isActive(status: string | null): boolean {
  return status === 'ACTIVE';
}

export async function enrichInnByName(
  prisma: PrismaClient,
  keys: string[]
): Promise<EnrichResult> {
  const byKey = new Map<string, DadataInnHit>();
  const wanted = [...new Set(keys.filter((k) => k.length > 0))];
  if (wanted.length === 0) return { byKey, used: false, reason: 'nothing_to_ask' };
  if (!isDadataEnabled()) return { byKey, used: false, reason: 'disabled' };

  const now = Date.now();
  let asked = false;
  for (const key of wanted) {
    const cached = cache.get(key);
    if (cached && now - cached.at < CACHE_TTL_MS) {
      if (cached.hit) byKey.set(key, cached.hit);
      continue;
    }
    let suggestions: Awaited<ReturnType<typeof suggestParty>>;
    try {
      suggestions = await suggestParty(prisma, key);
      asked = true;
    } catch (err) {
      // §3: побочный канал деградирует мягко — импорт идёт без ИНН из ЕГРЮЛ.
      log.warn('[card51] dadata enrich failed', err);
      return { byKey, used: false, reason: 'failed' };
    }
    const matched = suggestions.filter(
      (s) => isActive(s.status) && counterpartyKey(s.name).key === key
    );
    const hit =
      matched.length === 1 && matched[0]
        ? { inn: matched[0].inn, egrulName: matched[0].name }
        : null;
    cache.set(key, { at: now, hit });
    if (hit) byKey.set(key, hit);
  }
  return { byKey, used: asked || byKey.size > 0 || wanted.length > 0 };
}
