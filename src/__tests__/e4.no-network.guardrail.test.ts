import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * E4 (Track E) — determinism guardrail: the test suite must NEVER hit the real
 * network. Every external adapter (Resend/email, Telegram, Max, WhatsApp/Wazzup,
 * S3, ClamAV, 1C, СДО) is mocked. The ONLY legitimate real-network test is the S3
 * integration test, which is `skipIf`-gated on a live object-store endpoint.
 *
 * This guardrail fails the moment a new test constructs a real transport client
 * (without mocking its module) or calls `fetch()` without stubbing it — so future
 * changes cannot silently open a network channel from the suite.
 */

const SELF = 'e4.no-network.guardrail.test.ts';
const TESTS = path.join(process.cwd(), 'src', '__tests__');

// Real network is allowed ONLY here (skipIf on the object-store endpoint).
const REAL_NETWORK_ALLOWLIST = new Set(['storage.s3.integration.test.ts']);

function listTests(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listTests(full));
      continue;
    }
    if (/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const files = listTests(TESTS).filter((f) => {
  const b = path.basename(f);
  return b !== SELF && !REAL_NETWORK_ALLOWLIST.has(b);
});

describe('E4 — the suite never touches the real network', () => {
  it('finds test files to scan (guard against a vacuous pass)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no test constructs a real S3 / Resend / SMTP client without mocking its module', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const constructs = /new\s+S3Client\b|new\s+Resend\b|from\s+['"]nodemailer['"]/.test(src);
      if (!constructs) continue;
      const mocksModule =
        /vi\.mock\(\s*['"](resend|@aws-sdk\/client-s3|@\/lib\/storage|nodemailer)['"]/.test(src);
      if (!mocksModule) offenders.push(path.basename(f));
    }
    expect(
      offenders,
      `these construct a real transport client without mocking its module:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });

  it('every test that calls fetch() also stubs global.fetch', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // fetch( not preceded by `.`, a word char, or `-` (excludes obj.fetch, prefetch, "re-fetch").
      const callsFetch = /[^.\w-]fetch\s*\(/.test(src);
      if (!callsFetch) continue;
      const stubsFetch =
        /stubGlobal\(\s*['"]fetch['"]/.test(src) || /(global(This)?|window)\.fetch\s*=/.test(src);
      if (!stubsFetch) offenders.push(path.basename(f));
    }
    expect(
      offenders,
      `these call fetch() without stubbing global.fetch (potential real network):\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });
});
