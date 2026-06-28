/**
 * Unit tests for src/lib/security/redirect.ts
 */
import { describe, expect, it } from 'vitest';
import { assertAllowedStudentPortalUrl } from '@/lib/security/redirect';

describe('assertAllowedStudentPortalUrl', () => {
  // ── success paths ─────────────────────────────────────────────────────────
  it('returns the parsed URL for a valid https URL string', () => {
    const result = assertAllowedStudentPortalUrl('https://otsfera.cdoprof.com/path?q=1');
    expect(result).toBeInstanceOf(URL);
    expect(result.hostname).toBe('otsfera.cdoprof.com');
  });

  it('accepts a URL object directly (no re-parsing)', () => {
    const url = new URL('https://otsfera.cdoprof.com/login');
    const result = assertAllowedStudentPortalUrl(url);
    expect(result).toBe(url); // same reference — no copy created
  });

  it('accepts a custom allowlist hostname', () => {
    const result = assertAllowedStudentPortalUrl(
      'https://custom.example.com/portal',
      { allowlist: ['custom.example.com'] }
    );
    expect(result.hostname).toBe('custom.example.com');
  });

  it('is case-insensitive for the hostname (normalises to lower-case)', () => {
    const result = assertAllowedStudentPortalUrl(
      new URL('https://OTSFERA.CDOPROF.COM/test')
    );
    expect(result.hostname).toBe('otsfera.cdoprof.com');
  });

  // ── failure paths ─────────────────────────────────────────────────────────
  it('throws for non-https protocol', () => {
    expect(() =>
      assertAllowedStudentPortalUrl('http://otsfera.cdoprof.com/path')
    ).toThrow('Student portal URL must use HTTPS protocol.');
  });

  it('throws for a hostname not in the default allowlist', () => {
    expect(() =>
      assertAllowedStudentPortalUrl('https://evil.example.com/redirect')
    ).toThrow('Student portal URL hostname is not allowlisted.');
  });

  it('throws for a hostname not in a custom allowlist', () => {
    expect(() =>
      assertAllowedStudentPortalUrl('https://otsfera.cdoprof.com/path', {
        allowlist: ['other.trusted.com']
      })
    ).toThrow('Student portal URL hostname is not allowlisted.');
  });

  it('handles trailing whitespace in allowlist entries (normalised)', () => {
    const result = assertAllowedStudentPortalUrl(
      'https://clean.example.com/x',
      { allowlist: ['  clean.example.com  '] }
    );
    expect(result.hostname).toBe('clean.example.com');
  });
});
