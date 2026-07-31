import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';
import { FakeOneCAdapter } from './adapter-fake';
import { RestOneCAdapter } from './adapter-rest';
import type { OneCAdapter } from './adapter';

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
    // Ветка 'file' убрана 2026-07-28: файлового адаптера ТЗ не требует, из UI
    // он невыбираем (настройки принимают только fake|rest), а как значение env
    // он был ловушкой — обмен падал с «not implemented» вместо понятного
    // «неизвестный адаптер». Файловый обмен с 1С живёт отдельно — ручной
    // импорт Excel (/admin/import, спека 2026-06-09-1c-file-import).
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
