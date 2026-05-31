/**
 * pre-push helper: decides whether this push needs the integration gate.
 *
 * Reads git's pre-push stdin protocol (`<localRef> <localSha> <remoteRef> <remoteSha>`
 * per line), computes the changed files, and exits:
 *   0  -> integration-relevant changes AND Docker available -> run the gate
 *   2  -> no integration-relevant changes -> skip the gate
 *   1  -> relevant changes but Docker unavailable -> block (clear message)
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const TRIGGER_DIRS = ['prisma/', 'src/worker/', 'src/lib/services/'];
const ZERO = '0000000000000000000000000000000000000000';
const useShell = process.platform === 'win32';

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8'); // fd 0 = stdin
  } catch {
    return '';
  }
}

function gitLines(cmd: string): string[] {
  try {
    return execSync(cmd, { encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function changedFiles(): string[] {
  const files = new Set<string>();
  for (const line of readStdin().split('\n').map((s) => s.trim()).filter(Boolean)) {
    const [, localSha, , remoteSha] = line.split(/\s+/);
    if (!localSha || localSha === ZERO) continue; // branch deletion — nothing to push

    let range: string;
    if (!remoteSha || remoteSha === ZERO) {
      // New branch on the remote: diff against the merge-base with main.
      const base =
        gitLines(`git merge-base origin/main ${localSha}`)[0] ??
        gitLines(`git merge-base main ${localSha}`)[0] ??
        '';
      range = base ? `${base}..${localSha}` : localSha;
    } else {
      range = `${remoteSha}..${localSha}`;
    }
    for (const f of gitLines(`git diff --name-only ${range}`)) files.add(f);
  }
  return [...files];
}

function isRelevant(file: string): boolean {
  if (TRIGGER_DIRS.some((d) => file.startsWith(d))) return true;
  // A directly-edited integration test (one that spins up a real PrismaClient).
  if (/^src\/__tests__\/.*\.test\.tsx?$/.test(file) && existsSync(file)) {
    try {
      return readFileSync(file, 'utf8').includes('new PrismaClient(');
    } catch {
      return false;
    }
  }
  return false;
}

function dockerAvailable(): boolean {
  const r = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore', shell: useShell });
  return r.status === 0;
}

const relevant = changedFiles().filter(isRelevant);

if (relevant.length === 0) {
  console.log('[gate-precheck] No integration-relevant changes — skipping the gate.');
  process.exit(2);
}

console.log('[gate-precheck] Integration-relevant changes:\n  ' + relevant.join('\n  '));

if (!dockerAvailable()) {
  console.error(
    '\n[gate-precheck] Эти изменения затрагивают интеграционный слой, но Docker недоступен.\n' +
      'Запусти Docker Desktop и повтори push, либо (осознанно) `git push --no-verify`.\n'
  );
  process.exit(1);
}

process.exit(0);
