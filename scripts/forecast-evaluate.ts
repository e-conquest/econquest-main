/**
 * `npm run forecast:evaluate`: runs the pre-registered nowcast and forecast evaluations
 * (docs/validation/forecasts/) on the long free histories and saves the verdicts in
 * data/local/validation/forecasts.json. Needs a connection to DBnomics, the BIS, the BCB, Eurostat
 * and the IMF. See src/utils/forecastEval.ts.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { defaultFetcher } from '../src/utils/backtestRun';
import { runForecastEvaluations } from '../src/utils/forecastEvalRun';
import { appendAudit, auditFiles } from '../src/utils/auditStore';
import { loadWeoVintages } from '../src/utils/weoVintagesStore';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const resultFile = path.join(dataDir, 'local', 'validation', 'forecasts.json');
const out = await runForecastEvaluations({
  specDir: path.join(root, 'docs', 'validation', 'forecasts'),
  resultFile,
  fetcher: defaultFetcher,
  weoStore: loadWeoVintages(dataDir, { fresh: true }),
  onResult: (r) =>
    appendAudit(auditFiles(dataDir), {
      kind: 'validation',
      summary: `Forecast evaluation ${r.id} v${r.specVersion}: ${r.status.replace(/_/g, ' ')} (npm run forecast:evaluate)`,
      detail: { verdict: r.verdict, specHash: r.specHash, span: r.span, series: r.series.length, data: r.data },
    }),
});
for (const r of Object.values(out.results)) {
  console.log(`${r.id} (v${r.specVersion}, ${r.series.length} series, ${r.span.from} to ${r.span.to}): ${r.verdict}`);
  for (const c of r.coverage || []) console.log(`  ${c.h} year(s) ahead: ${c.cases} cases over ${c.years} years, inside the 10-90 band ${c.coverage} (90% range ${c.coverageRange[0]} to ${c.coverageRange[1]})`);
  for (const h of r.horizons) console.log(`  ${h.h} ahead: ${h.cases} cases, RMSE ${h.rmseModel} vs ${h.rmseBench}; 70% band held ${h.coverage70 ?? 'n/a'}, 90% band held ${h.coverage90 ?? 'n/a'}`);
}
for (const p of out.problems) console.log(`Problem: ${p}`);
console.log(`Saved in ${path.relative(root, resultFile)}.`);
