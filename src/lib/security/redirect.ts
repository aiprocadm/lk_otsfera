const DEFAULT_ALLOWED_HOSTS = ['otsfera.cdoprof.com'];

export function assertAllowedStudentPortalUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  const allowedHosts = (process.env.STUDENT_PORTAL_ALLOWED_HOSTS ?? DEFAULT_ALLOWED_HOSTS.join(','))
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  if (url.protocol !== 'https:') {
    throw new Error('Student portal URL must use HTTPS');
  }

  if (!allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error('Student portal URL host is not allowed');
  }

  return url;
}
