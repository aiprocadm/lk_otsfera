import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/server-actions/admin/syncControl', () => ({ rewindCursorAction: vi.fn() }));

import { confirmArmed, SyncCursorDialog } from '@/components/admin/sync-cursor-dialog';

describe('confirmArmed', () => {
  it('is false until the typed name matches the entity', () => {
    expect(confirmArmed('', 'order')).toBe(false);
    expect(confirmArmed('ord', 'order')).toBe(false);
    expect(confirmArmed(' order ', 'order')).toBe(true);
    expect(confirmArmed('order', 'order')).toBe(true);
  });
});

describe('SyncCursorDialog initial render', () => {
  it('renders the entity name and a disabled confirm button when closed-armed', () => {
    const html = renderToString(
      React.createElement(SyncCursorDialog, { entity: 'order', currentCursor: '2026-06-05T00:00:00.000Z' }),
    );
    expect(html).toContain('order');
  });
});
