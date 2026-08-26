import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';
import { FakeMangoAdapter } from './adapter-fake';
import { RestMangoAdapter } from './adapter-rest';
import type { MangoAdapter } from './types';

export type { MangoAdapter } from './types';

let cached: MangoAdapter | null = null;

export function getMangoAdapter(): MangoAdapter {
  if (cached) return cached;
  // `У-124`: вид адаптера — поле формы. Приоритет тот же, что у остальных
  // настроек: база → переменная сервера → умолчание.
  const kind = (cachedIntegrationSetting('mango.adapter') ?? process.env.MANGO_ADAPTER ?? 'fake')
    .trim()
    .toLowerCase();
  switch (kind) {
    case 'fake':
      cached = new FakeMangoAdapter();
      return cached;
    case 'rest':
      cached = new RestMangoAdapter();
      return cached;
    default:
      throw new Error(`Unknown Mango adapter value: ${kind}`);
  }
}

/**
 * Сброс закэшированного адаптера. Нужен не только тестам: с `У-124` вид
 * адаптера — поле формы, и после сохранения кэш обязан перечитать настройку,
 * иначе переключение «тестовый ↔ боевой» не подействует до перезапуска.
 */
export function resetMangoAdapter(): void {
  cached = null;
}
