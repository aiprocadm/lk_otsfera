import { describe, it, expect } from 'vitest';
import { toast } from '@/lib/ui/toast';
describe('toast wrapper', () => {
  it('re-exports sonner toast with success and error helpers', () => {
    expect(typeof toast).toBe('function');
    expect(typeof toast.success).toBe('function');
    expect(typeof toast.error).toBe('function');
  });
});
