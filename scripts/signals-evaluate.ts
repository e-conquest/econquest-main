/**
 * `npm run signals:evaluate`: runs the pre-registered currency factor tests (carry, value,
 * momentum; docs/validation/signals/) and saves the verdicts in data/local/validation/signals.json.
 * Needs a connection to Frankfurter (ECB rates not already saved), the BIS and DBnomics. See
 * src/utils/fxFactors.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultFetcher } from '../src/utils/backtestRun';
import { runSignalEvaluations } from '../src/utils/fxFactorsRun';
import { readFxHistoryFile } from '../src/utils/fxHistory';
import { appendAudit, auditFiles } from '../src/utils/auditStore';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const resultFile = path.join(dataDir, 'local', 'validation', 'signals.json');
let savedFx = null;
try {
  savedFx = readFxHistoryFile(JSON.parse(fs.readFileSync(path.join(dataDir, 'live', 'fx-history.json'), 'utf8')));
} catch {
  savedFx = null;
}
const out = await runSignalEvaluations({
  specDir: path.join(root, 'docs', 'validation', 'signals'),
  resultFile,
  fetcher: defaultFetcher,
  savedFx,
  onResult: (r) =>
    appendAudit(auditFiles(dataDir), {
      kind: 'validation',
      summary: `Signal test ${r.id} v${r.specVersion}: ${r.status.replace(/_/g, ' ')} (npm run signals:evaluate)`,
      detail: { verdict: r.verdict, specHash: r.specHash, span: r.span, currencies: r.currencies.length },
    }),
});
for (const r of Object.values(out.results)) console.log(`${r.id} (v${r.specVersion}, ${r.currencies.length} currencies, ${r.span.from} to ${r.span.to}): ${r.verdict}`);
for (const p of out.problems) console.log(`Problem: ${p}`);
console.log(`Saved in ${path.relative(root, resultFile)}.`);
