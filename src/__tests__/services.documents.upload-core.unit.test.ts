import { describe, it, expect } from 'vitest';
import { validateUploadFile } from '@/lib/services/documents/upload-core';

const buf = (sig: number[], pad = 8) =>
  Buffer.from([...sig, ...Array(Math.max(0, pad - sig.length)).fill(0)]);

describe('validateUploadFile — config-driven (§11/§13)', () => {
  it('accepts a .doc (msword) within limit', () => {
    const r = validateUploadFile({ size: 1024, mimeType: 'application/msword', buffer: buf([0xd0, 0xcf]) });
    expect(r.ok).toBe(true);
  });
  it('rejects file above 200MB', () => {
    const r = validateUploadFile({ size: 201 * 1024 * 1024, mimeType: 'application/pdf', buffer: buf([0x25, 0x50, 0x44, 0x46]) });
    expect(r).toEqual({ ok: false, error: 'too_large' });
  });
  it('rejects disallowed mime', () => {
    const r = validateUploadFile({ size: 10, mimeType: 'application/x-msdownload', buffer: buf([0x4d, 0x5a]) });
    expect(r).toEqual({ ok: false, error: 'invalid_mime' });
  });
});
