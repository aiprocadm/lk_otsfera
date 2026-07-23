import type { OneCAdapter } from './adapter';
import { FakeOneCAdapter } from './adapter-fake';
import { RestOneCAdapter } from './adapter-rest';
import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';

let cached: OneCAdapter | null = null;
/** Ключ конфига, по которому собран `cached` — для пересборки при изменении. */
let cachedKey: string | null = null;

/**
 * Фабрика адаптера 1С. Вид адаптера, адрес API и токен читаются из настроек
 * интеграций (`cachedIntegrationSetting`: БД после prime, env — fallback), а не
 * из сырого env. Смена настроек в UI подхватывается без рестарта: синглтон
 * пересобирается, когда меняется `kind|url|token`. В воркере sync-процессоры
 * праймят кэш перед вызовом, чтобы новые креды доехали до фоновых задач.
 */
export function getOneCAdapter(): OneCAdapter {
  const kind = (cachedIntegrationSetting('onec.adapter') ?? 'fake').trim().toLowerCase();
  const baseUrl = cachedIntegrationSetting('onec.apiUrl');
  const token = cachedIntegrationSetting('onec.apiToken');
  const key = `${kind}|${baseUrl ?? ''}|${token ?? ''}`;
  if (cached && cachedKey === key) return cached;

  switch (kind) {
    case 'fake':
      cached = new FakeOneCAdapter();
      cachedKey = key;
      return cached;
    case 'rest': {
      if (!baseUrl) throw new Error('ONE_C_ADAPTER=rest requires ONE_C_API_URL');
      if (!token) throw new Error('ONE_C_ADAPTER=rest requires ONE_C_API_TOKEN');
      cached = new RestOneCAdapter({ baseUrl, token });
      cachedKey = key;
      return cached;
    }
    case 'file':
      throw new Error('File 1C adapter is not implemented yet (Phase 3)');
    default:
      throw new Error(`Unknown ONE_C_ADAPTER value: ${kind}`);
  }
}

export function resetOneCAdapter(): void {
  cached = null;
  cachedKey = null;
}

export type { OneCAdapter } from './adapter';
export { FileOneCAdapter } from './adapter-file';
export * from './dto';
