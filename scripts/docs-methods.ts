/** Writes docs/METHODS.md (npm run docs:methods). */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { methodsFromRepo } from '../src/utils/methodsDocNode.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
writeFileSync(new URL('../docs/METHODS.md', import.meta.url), methodsFromRepo(root));
console.log('Wrote docs/METHODS.md');
