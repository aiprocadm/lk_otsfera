// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

import DeprecatedAdminOrdersPage from '@/app/admin/orders/page';

describe('DeprecatedAdminOrdersPage', () => {
  beforeEach(() => {
    nav.redirect.mockClear();
  });

  it('redirects to /admin/dashboard', async () => {
    expect(() => DeprecatedAdminOrdersPage()).toThrow('REDIRECT:/admin/dashboard');
  });
});
