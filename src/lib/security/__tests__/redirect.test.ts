import { describe, expect, it, beforeEach } from 'vitest';
import { assertAllowedStudentPortalUrl } from '@/lib/security/redirect';

describe('assertAllowedStudentPortalUrl', () => {
  beforeEach(() => {
    process.env.STUDENT_PORTAL_ALLOWED_HOSTS = 'otsfera.cdoprof.com';
  });

  it('allows configured https host', () => {
    const url = assertAllowedStudentPortalUrl('https://otsfera.cdoprof.com/login');
    expect(url.hostname).toBe('otsfera.cdoprof.com');
  });

  it('rejects non-https url', () => {
    expect(() => assertAllowedStudentPortalUrl('http://otsfera.cdoprof.com/login')).toThrow();
  });

  it('rejects non-allowlisted host', () => {
    expect(() => assertAllowedStudentPortalUrl('https://evil.example.com')).toThrow();
  });
});
