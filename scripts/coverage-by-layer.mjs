import { readFileSync } from 'node:fs';

const s = JSON.parse(readFileSync('./coverage/coverage-summary.json', 'utf8'));
const agg = {};
for (const [f, v] of Object.entries(s)) {
  if (f === 'total') continue;
  const norm = f.split('\\').join('/');
  const i = norm.indexOf('/src/');
  const rel = i >= 0 ? norm.slice(i + 5) : norm;
  const parts = rel.split('/');
  let layer = parts[0];
  if (['app', 'lib', 'components'].includes(parts[0]) && parts.length > 1) {
    layer = parts[0] + '/' + parts[1].replace(/[()]/g, '');
  }
  agg[layer] ??= { cov: 0, tot: 0, files: 0, zero: 0 };
  agg[layer].cov += v.lines.covered;
  agg[layer].tot += v.lines.total;
  agg[layer].files += 1;
  if (v.lines.covered === 0 && v.lines.total > 0) agg[layer].zero += 1;
}
const rows = Object.entries(agg)
  .map(([l, a]) => ({ l, ...a }))
  .sort((x, y) => y.tot - x.tot);
console.log(
  'layer'.padEnd(28) + 'lines%'.padStart(8) + 'cov/total'.padStart(14) + 'files'.padStart(7) + '0%f'.padStart(6)
);
for (const r of rows) {
  const pct = r.tot ? (100 * r.cov) / r.tot : 100;
  console.log(
    r.l.padEnd(28) + pct.toFixed(1).padStart(8) + `${r.cov}/${r.tot}`.padStart(14) + String(r.files).padStart(7) + String(r.zero).padStart(6)
  );
}
