// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  })
}));
vi.mock('next/navigation', () => nav);

import Home from '@/app/page';

describe('Home (root page)', () => {
  it('redirects to /login (root is a safety net; real redirect lives in middleware)', () => {
    expect(() => Home()).toThrow('REDIRECT:/login');
    expect(nav.redirect).toHaveBeenCalledWith('/login');
  });
});
