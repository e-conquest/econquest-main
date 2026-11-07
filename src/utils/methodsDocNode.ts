/** Node side of docs/METHODS.md: reads the pre-registered tests and recorded verdicts from docs/. */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { methodsMarkdown, type PreregisteredSpec, type RecordedVerdict } from './methodsDoc';

export function methodsFromRepo(root: string): string {
  const dir = path.join(root, 'docs/validation/preregistered');
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')).files as Record<string, string>;
  const specs: PreregisteredSpec[] = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
    .sort()
    .map((file) => ({ ...JSON.parse(readFileSync(path.join(dir, file), 'utf8')), file, hash: manifest[file] }));
  const recorded = JSON.parse(readFileSync(path.join(root, 'docs/validation/recorded-verdicts.json'), 'utf8')).verdicts as RecordedVerdict[];
  return methodsMarkdown(specs, recorded);
}
