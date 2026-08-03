import { FakeMangoAdapter } from './adapter-fake';
import { RestMangoAdapter } from './adapter-rest';
import type { MangoAdapter } from './types';

export type { MangoAdapter } from './types';

let cached: MangoAdapter | null = null;

export function getMangoAdapter(): MangoAdapter {
  if (cached) return cached;
  const kind = (process.env.MANGO_ADAPTER ?? 'fake').trim().toLowerCase();
  switch (kind) {
    case 'fake':
      cached = new FakeMangoAdapter();
      return cached;
    case 'rest':
      cached = new RestMangoAdapter();
      return cached;
    default:
      throw new Error(`Unknown MANGO_ADAPTER value: ${kind}`);
  }
}

export function __resetMangoAdapter(): void {
  cached = null;
}
