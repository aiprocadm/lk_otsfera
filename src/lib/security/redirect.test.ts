import { describe, expect, it } from 'vitest';
import { assertAllowedStudentPortalUrl } from './redirect';

describe('assertAllowedStudentPortalUrl', () => {
  it('allows https URL with default allowlisted hostname', () => {
    const parsed = assertAllowedStudentPortalUrl('https://otsfera.cdoprof.com/student');
    expect(parsed.hostname).toBe('otsfera.cdoprof.com');
  });

  it('allows explicitly configured hostname', () => {
    const parsed = assertAllowedStudentPortalUrl('https://staging.otsfera.cdoprof.com/path', {
      allowlist: ['otsfera.cdoprof.com', 'staging.otsfera.cdoprof.com']
    });
    expect(parsed.hostname).toBe('staging.otsfera.cdoprof.com');
  });

  it('rejects non-https protocol', () => {
    expect(() => assertAllowedStudentPortalUrl('http://otsfera.cdoprof.com')).toThrow(
      'Student portal URL must use HTTPS protocol.'
    );
  });

  it('rejects non-allowlisted hostname', () => {
    expect(() => assertAllowedStudentPortalUrl('https://evil.example.com')).toThrow(
      'Student portal URL hostname is not allowlisted.'
    );
  });
});
