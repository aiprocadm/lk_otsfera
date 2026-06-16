import { describe, expect, it } from 'vitest';
import { validateMagicBytes, extensionFor } from '@/lib/storage/mimeValidator';

function bytes(...arr: number[]): Uint8Array {
  return new Uint8Array(arr);
}

function withPadding(prefix: number[], totalLen = 32): Uint8Array {
  const buf = new Uint8Array(totalLen);
  buf.set(prefix, 0);
  return buf;
}

describe('mimeValidator', () => {
  it('accepts a PDF with %PDF magic bytes', () => {
    const buf = withPadding([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const res = validateMagicBytes('application/pdf', buf);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.mime).toBe('application/pdf');
  });

  it('rejects PDF when declared MIME is different', () => {
    const buf = withPadding([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const res = validateMagicBytes('image/png', buf);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('mime_mismatch');
  });

  it('accepts JPEG (FF D8 FF)', () => {
    const buf = withPadding([0xff, 0xd8, 0xff, 0xe0]);
    const res = validateMagicBytes('image/jpeg', buf);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.mime).toBe('image/jpeg');
  });

  it('accepts PNG (89 50 4E 47 0D 0A 1A 0A)', () => {
    const buf = withPadding([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = validateMagicBytes('image/png', buf);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.mime).toBe('image/png');
  });

  it('accepts DOCX (zip + word/ marker)', () => {
    const zipSig = [0x50, 0x4b, 0x03, 0x04];
    const marker = new TextEncoder().encode('word/document.xml');
    const buf = new Uint8Array(64);
    buf.set(zipSig, 0);
    buf.set(marker, 30);
    const res = validateMagicBytes(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buf
    );
    expect(res.ok).toBe(true);
  });

  it('accepts XLSX (zip + xl/ marker)', () => {
    const zipSig = [0x50, 0x4b, 0x03, 0x04];
    const marker = new TextEncoder().encode('xl/workbook.xml');
    const buf = new Uint8Array(64);
    buf.set(zipSig, 0);
    buf.set(marker, 30);
    const res = validateMagicBytes(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buf
    );
    expect(res.ok).toBe(true);
  });

  it('rejects unsupported MIME (plain text)', () => {
    const buf = new TextEncoder().encode('hello world this is plain text');
    const res = validateMagicBytes('text/plain', buf);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('unsupported_signature');
  });

  it('rejects truncated header (less than 8 bytes)', () => {
    const res = validateMagicBytes('application/pdf', bytes(0x25, 0x50, 0x44));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('too_short');
  });

  it('rejects zip that is neither docx nor xlsx', () => {
    const zipSig = [0x50, 0x4b, 0x03, 0x04];
    const marker = new TextEncoder().encode('ppt/slides/slide1.xml');
    const buf = new Uint8Array(128);
    buf.set(zipSig, 0);
    buf.set(marker, 30);
    const res = validateMagicBytes(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buf
    );
    expect(res.ok).toBe(false);
  });

  it('extensionFor returns correct extension for each supported mime', () => {
    expect(extensionFor('application/pdf')).toBe('pdf');
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/png')).toBe('png');
    expect(extensionFor('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx');
    expect(extensionFor('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('xlsx');
  });

  // ── mime_mismatch branches for each magic-byte type ──────────────────────

  it('rejects JPEG when declared MIME is wrong', () => {
    const buf = withPadding([0xff, 0xd8, 0xff, 0xe0]);
    const res = validateMagicBytes('application/pdf', buf);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('mime_mismatch');
  });

  it('rejects PNG when declared MIME is wrong', () => {
    const buf = withPadding([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = validateMagicBytes('image/jpeg', buf);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('mime_mismatch');
  });

  it('rejects DOCX when declared MIME is wrong (e.g. xlsx instead of docx)', () => {
    const zipSig = [0x50, 0x4b, 0x03, 0x04];
    const marker = new TextEncoder().encode('word/document.xml');
    const buf = new Uint8Array(64);
    buf.set(zipSig, 0);
    buf.set(marker, 30);
    const res = validateMagicBytes(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buf
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('mime_mismatch');
  });

  it('rejects XLSX when declared MIME is wrong (e.g. docx instead of xlsx)', () => {
    const zipSig = [0x50, 0x4b, 0x03, 0x04];
    const marker = new TextEncoder().encode('xl/workbook.xml');
    const buf = new Uint8Array(64);
    buf.set(zipSig, 0);
    buf.set(marker, 30);
    const res = validateMagicBytes(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buf
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('mime_mismatch');
  });
});
