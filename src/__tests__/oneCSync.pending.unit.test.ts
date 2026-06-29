import { describe, it, expect } from 'vitest';
import { isTransientSkip } from '@/lib/services/oneCSync/pending';

describe('isTransientSkip', () => {
  it('treats dependency-ordering skips as transient', () => {
    expect(isTransientSkip('organization_not_found')).toBe(true);
    expect(isTransientSkip('order_not_found')).toBe(true);
    expect(isTransientSkip('document_fetch_failed')).toBe(true);
  });
  it('treats partner/scope skips as permanent', () => {
    expect(isTransientSkip('partner_not_found')).toBe(false);
    expect(isTransientSkip('no_partner_external_id')).toBe(false);
    expect(isTransientSkip('out_of_scope')).toBe(false);
  });
  it('treats unknown reasons as permanent (fail closed — do not retry forever)', () => {
    expect(isTransientSkip('something_new')).toBe(false);
  });
});
