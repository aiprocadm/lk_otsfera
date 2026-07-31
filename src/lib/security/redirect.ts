const DEFAULT_ALLOWED_HOSTNAMES = ['otsfera.cdoprof.com'] as const;

const normalizeHost = (value: string) => value.trim().toLowerCase();

const parseAllowedHostnames = (allowlist: string[]) => {
  return new Set(allowlist.map(normalizeHost).filter(Boolean));
};

export function assertAllowedStudentPortalUrl(
  url: string | URL,
  options?: { allowlist?: string[] }
): URL {
  const parsedUrl = typeof url === 'string' ? new URL(url) : url;

  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Student portal URL must use HTTPS protocol.');
  }

  const allowedHostnames = parseAllowedHostnames(
    options?.allowlist ?? [...DEFAULT_ALLOWED_HOSTNAMES]
  );
  const hostname = normalizeHost(parsedUrl.hostname);

  if (!allowedHostnames.has(hostname)) {
    throw new Error('Student portal URL hostname is not allowlisted.');
  }

  return parsedUrl;
}
