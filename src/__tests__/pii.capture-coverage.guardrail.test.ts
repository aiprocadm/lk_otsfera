/**
 * §25.7 guardrail: каждый контекст PII_CONTEXTS реально вызывается из своего
 * callSite-файла, и ни один сервис не использует контекст мимо реестра.
 * Ограничение (задокументировано в спеке): проверяются только известные
 * реестру файлы — новый сервис, читающий ПДн без регистрации контекста,
 * ловится ревью + правилом CLAUDE.md §12, не этим тестом.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PII_CONTEXTS } from '@/lib/pii/contexts';

const ROOT = process.cwd();

describe('PII capture coverage guardrail', () => {
  it('каждый контекст упоминается в своём callSite-файле рядом с recordPiiAccess', () => {
    const missing: string[] = [];
    for (const [key, ctx] of Object.entries(PII_CONTEXTS)) {
      const src = readFileSync(path.join(ROOT, ctx.callSite), 'utf8');
      const hasCall = src.includes('recordPiiAccess'); // ловит и recordPiiAccessMany
      const hasContext = src.includes(`'${key}'`);
      if (!hasCall || !hasContext) missing.push(`${key} → ${ctx.callSite}`);
    }
    expect(
      missing,
      `Контексты без вызова recordPiiAccess в заявленном callSite:\n  ${missing.join('\n  ')}`
    ).toEqual([]);
  });

  it('callSite-файлы не используют контексты мимо реестра', () => {
    const known = new Set(Object.keys(PII_CONTEXTS));
    const files = [...new Set(Object.values(PII_CONTEXTS).map((c) => c.callSite))];
    const rogue: string[] = [];
    for (const file of files) {
      const src = readFileSync(path.join(ROOT, file), 'utf8');
      // контекст передаётся как context: '<key>'
      for (const m of src.matchAll(/context:\s*'([a-z0-9_]+)'/g)) {
        if (!known.has(m[1])) rogue.push(`${file}: ${m[1]}`);
      }
    }
    expect(rogue).toEqual([]);
  });
});
