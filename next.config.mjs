const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  // Минимальная CSP без script-src: App Router с инлайн-скриптами Next требует
  // nonce-инфраструктуру через middleware — отложено (R2). Эти директивы
  // безопасны без nonce и закрывают: встраивание в iframe (дублирует XFO),
  // object/embed-инъекции, подмену <base>, увод form action на чужой origin.
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'"
  }
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverActions: { bodySizeLimit: '10mb' } },
  // pino использует Node-API (streams/sonic-boom) — оставить внешним пакетом,
  // а не бандлить в серверный граф RSC.
  serverExternalPackages: ['pino'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  }
};

export default nextConfig;
