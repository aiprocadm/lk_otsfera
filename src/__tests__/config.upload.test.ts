import { describe, it, expect, afterEach } from 'vitest';
import { resolveMaxFileSizeMb, maxFileSizeBytes, DEFAULT_MAX_FILE_SIZE_MB, ALLOWED_MIME_TYPES } from '@/lib/config/upload';

const ORIG = process.env.DOCUMENT_MAX_FILE_SIZE_MB;
afterEach(() => { if (ORIG === undefined) delete process.env.DOCUMENT_MAX_FILE_SIZE_MB; else process.env.DOCUMENT_MAX_FILE_SIZE_MB = ORIG; });

describe('config/upload', () => {
  it('defaults to 200 MB (§11)', () => {
    delete process.env.DOCUMENT_MAX_FILE_SIZE_MB;
    expect(DEFAULT_MAX_FILE_SIZE_MB).toBe(200);
    expect(resolveMaxFileSizeMb()).toBe(200);
    expect(maxFileSizeBytes()).toBe(200 * 1024 * 1024);
  });
  it('honors a valid env override', () => {
    process.env.DOCUMENT_MAX_FILE_SIZE_MB = '50';
    expect(resolveMaxFileSizeMb()).toBe(50);
  });
  it.each(['0', '-5', 'abc', ''])('falls back to default on invalid env %s', (v) => {
    process.env.DOCUMENT_MAX_FILE_SIZE_MB = v;
    expect(resolveMaxFileSizeMb()).toBe(DEFAULT_MAX_FILE_SIZE_MB);
  });
  it('allow-list includes .doc and .docx (§13)', () => {
    expect(ALLOWED_MIME_TYPES.has('application/msword')).toBe(true);
    expect(ALLOWED_MIME_TYPES.has('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
  });
});
