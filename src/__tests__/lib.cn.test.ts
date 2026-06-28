import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/ui/cn';
describe('cn', () => {
  it('joins truthy classes and drops falsy', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c');
  });
  it('lets later tailwind classes win conflicts (tailwind-merge)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
});
