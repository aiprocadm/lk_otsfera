import type { PrismaClient } from '@prisma/client';
import { log } from '@/lib/logging';
import { getSettingValue } from '@/lib/config/integrationSettings';

/**
 * Подсказки организаций по названию/ИНН через DaData (ФТ-13.2).
 *
 * Читает настройки `dadata.enabled` + `dadata.apiKey` из БД (env — fallback).
 * Выключено / нет ключа / пустой запрос / ошибка сети / таймаут → пустой список:
 * формы-потребители деградируют до ручного ввода без ошибок. Ключ DaData
 * остаётся на сервере — наружу отдаётся только нормализованный результат.
 */

const DADATA_URL =
  'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party';
const DADATA_TIMEOUT_MS = 3000;
const MAX_SUGGESTIONS = 10;

const TRUTHY = new Set(['true', '1', 'on', 'yes']);

export type PartySuggestion = {
  name: string;
  inn: string;
  kpp: string | null;
  ogrn: string | null;
  address: string | null;
};

type RawSuggestion = {
  value?: unknown;
  data?: {
    inn?: unknown;
    kpp?: unknown;
    ogrn?: unknown;
    address?: { value?: unknown } | null;
  } | null;
};

/**
 * Чистый нормализатор ответа DaData: из `body.suggestions[]` берёт только
 * элементы с названием (`value`) и ИНН (`data.inn`). На любую непонятную форму
 * (untrusted JSON) возвращает то, что удалось разобрать, не бросая исключений.
 */
export function normalizeParty(body: unknown): PartySuggestion[] {
  const suggestions = (body as { suggestions?: unknown } | null)?.suggestions;
  if (!Array.isArray(suggestions)) return [];

  const out: PartySuggestion[] = [];
  for (const s of suggestions) {
    const rec = s as RawSuggestion;
    const name = typeof rec.value === 'string' ? rec.value : null;
    const inn = typeof rec.data?.inn === 'string' ? rec.data.inn : null;
    if (!name || !inn) continue;
    out.push({
      name,
      inn,
      kpp: typeof rec.data?.kpp === 'string' ? rec.data.kpp : null,
      ogrn: typeof rec.data?.ogrn === 'string' ? rec.data.ogrn : null,
      address:
        typeof rec.data?.address?.value === 'string' ? rec.data.address.value : null
    });
  }
  return out;
}

export async function suggestParty(
  prisma: PrismaClient,
  query: string
): Promise<PartySuggestion[]> {
  const q = query.trim();
  if (!q) return [];

  const enabled = (await getSettingValue(prisma, 'dadata.enabled'))?.trim().toLowerCase();
  if (!enabled || !TRUTHY.has(enabled)) return [];

  const apiKey = await getSettingValue(prisma, 'dadata.apiKey');
  if (!apiKey) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DADATA_TIMEOUT_MS);
  try {
    const res = await fetch(DADATA_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Token ${apiKey}`
      },
      body: JSON.stringify({ query: q, count: MAX_SUGGESTIONS }),
      signal: controller.signal
    });
    if (!res.ok) return [];
    return normalizeParty(await res.json());
  } catch (err) {
    log.warn('[dadata] suggest party failed — degrading to empty', {
      error: err instanceof Error ? err.message : String(err)
    });
    return [];
  /* v8 ignore next 2 -- V8 marks the finally as a branch; the exceptional-completion edge is unreachable (bare catch catches all, clearTimeout cannot throw) */
  } finally {
    clearTimeout(timer);
  }
}
