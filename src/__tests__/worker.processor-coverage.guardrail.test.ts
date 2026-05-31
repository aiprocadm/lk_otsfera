import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Worker processors that intentionally have NO dedicated test.
// Add an entry ONLY with a written justification. The three below are tracked
// debt closed by Tasks 3-5 of this plan; each task removes its entry.
const ALLOWLIST = new Set<string>([]);

// vitest runs from the repo root, so cwd is the project root.
const ROOT = process.cwd();
const PROCESSORS_DIR = path.join(ROOT, 'src', 'worker', 'processors');
const TESTS_DIR = path.join(ROOT, 'src', '__tests__');

function processorModuleNames(): string[] {
  return readdirSync(PROCESSORS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((f) => f.replace(/\.ts$/, ''));
}

function allTestSources(): string {
  return readdirSync(TESTS_DIR)
    .filter((f) => /\.test\.tsx?$/.test(f))
    .map((f) => readFileSync(path.join(TESTS_DIR, f), 'utf8'))
    .join('\n');
}

describe('worker processor coverage guardrail', () => {
  it('every worker processor is referenced by at least one test', () => {
    const sources = allTestSources();
    const uncovered = processorModuleNames().filter(
      // substring match also catches relative imports, not just the @/ alias
      (mod) => !ALLOWLIST.has(mod) && !sources.includes(`worker/processors/${mod}`)
    );
    expect(
      uncovered,
      `These worker processors have no test importing them. Add an integration ` +
        `test, or add the module name to ALLOWLIST with a justification:\n  ${uncovered.join('\n  ')}`
    ).toEqual([]);
  });
});
