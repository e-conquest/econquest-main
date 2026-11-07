/**
 * `npm run backtest`: runs the pre-registered backtests (docs/validation/preregistered/) on the
 * long free histories and saves the verdicts in data/local/validation/results.json, the same run
 * as Menu > Models & validation > Run backtests. Needs a connection to the BIS, DBnomics and CFTC.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { runBacktests, validationFilePath } from '../src/utils/backtestRun';
import { appendAudit, auditFiles } from '../src/utils/auditStore';
import { gdeltDailyDir, loadAllMonths } from '../src/utils/gdeltDailyStore';
import { ucdpData } from '../src/utils/ucdpStore';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const out = await runBacktests({
  specDir: path.join(root, 'docs', 'validation', 'preregistered'),
  resultFile: validationFilePath(dataDir),
  local: { gdeltMonths: () => loadAllMonths(gdeltDailyDir(dataDir)), ucdp: () => ucdpData(dataDir) },
  onResult: (r) =>
    appendAudit(auditFiles(dataDir), {
      kind: 'validation',
      summary: `Backtest ${r.id} v${r.specVersion}: ${r.status.replace(/_/g, ' ')} (npm run backtest)`,
      detail: { verdict: r.verdict, framework: r.framework ?? 1, stricterCheck: r.robustness?.verdict, specHash: r.specHash, cases: r.cases, hits: r.hits, baseRatePct: r.baseRatePct, pValue: r.pValue, span: r.span, data: r.data },
    }),
});
for (const r of Object.values(out.results)) {
  console.log(`${r.id} (v${r.specVersion}, method ${r.framework ?? 1}, ${r.series.length} series, ${r.span.from} to ${r.span.to}): ${r.verdict}`);
  if (r.robustness && (r.framework ?? 1) === 1) console.log(`  Stricter check (method 2): ${r.robustness.verdict}`);
}
for (const p of out.problems) console.log(`Problem: ${p}`);
console.log(`Saved in ${path.relative(root, validationFilePath(dataDir))}.`);
