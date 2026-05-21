import type { OneCAdapter } from './adapter';
import { FakeOneCAdapter } from './adapter-fake';

let cached: OneCAdapter | null = null;

export function getOneCAdapter(): OneCAdapter {
  if (cached) return cached;
  const kind = (process.env.ONE_C_ADAPTER ?? 'fake').trim().toLowerCase();
  switch (kind) {
    case 'fake':
      cached = new FakeOneCAdapter();
      return cached;
    case 'rest':
      throw new Error('REST 1C adapter is not implemented yet (Phase 3)');
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
export * from './dto';
