import type { OneCAdapter } from './adapter';
import { FakeOneCAdapter } from './adapter-fake';
import { RestOneCAdapter } from './adapter-rest';

let cached: OneCAdapter | null = null;

export function getOneCAdapter(): OneCAdapter {
  if (cached) return cached;
  const kind = (process.env.ONE_C_ADAPTER ?? 'fake').trim().toLowerCase();
  switch (kind) {
    case 'fake':
      cached = new FakeOneCAdapter();
      return cached;
    case 'rest': {
      const baseUrl = process.env.ONE_C_API_URL;
      const token = process.env.ONE_C_API_TOKEN;
      if (!baseUrl) throw new Error('ONE_C_ADAPTER=rest requires ONE_C_API_URL');
      if (!token) throw new Error('ONE_C_ADAPTER=rest requires ONE_C_API_TOKEN');
      cached = new RestOneCAdapter({ baseUrl, token });
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
}

export type { OneCAdapter } from './adapter';
export { FileOneCAdapter } from './adapter-file';
export * from './dto';
