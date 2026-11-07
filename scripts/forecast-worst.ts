/**
 * `npm run forecast:worst`: reads the saved evaluation verdicts (data/local/validation/forecasts.json,
 * no network) and prints, for each evaluation and horizon, the series where the model did worst
 * against its benchmark. A diagnostic only: it changes nothing and runs nothing.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { loadForecastValidation } from '../src/utils/forecastEvalRun';
import { worstSeries } from '../src/utils/forecastRegister';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const file = path.join(dataDir, 'local', 'validation', 'forecasts.json');
const n = Number(process.argv[2]) || 6;
const v = loadForecastValidation(file);
if (!Object.keys(v.results).length) console.log(`No verdicts in ${path.relative(root, file)} yet: run npm run forecast:evaluate first.`);
for (const r of Object.values(v.results)) {
  console.log(`${r.id} (${r.status.replace(/_/g, ' ')}):`);
  for (const h of r.horizons) console.log(`  ${h.h} ahead, worst: ${worstSeries(h.bySeries, n).map((b) => `${b.where} ${b.relRmse}`).join(', ')}`);
}
