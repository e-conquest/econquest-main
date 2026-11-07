/** Writes docs/DATA_LICENCES.md from src/data/dataLicences.ts (npm run docs:licences). */
import { writeFileSync } from 'node:fs';
import { licencesMarkdown } from '../src/data/dataLicences.ts';

writeFileSync(new URL('../docs/DATA_LICENCES.md', import.meta.url), licencesMarkdown());
console.log('Wrote docs/DATA_LICENCES.md');
