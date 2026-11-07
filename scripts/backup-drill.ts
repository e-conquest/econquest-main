/**
 * npm run backup:drill -- <backup file>
 *
 * Restores a Menu > Backup file into a throwaway fresh install and checks everything comes back
 * and no key is carried. Your own data folder is not touched. See docs/BACKUP_AND_RESTORE.md.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runBackupDrill } from '../src/utils/backupDrill';

const file = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (!file) {
  console.log('Usage: npm run backup:drill -- <backup file from Menu > Backup>');
  process.exit(2);
}
let text: string;
try {
  text = fs.readFileSync(file, 'utf8');
} catch (e) {
  console.log(`Cannot read ${file} (${(e as NodeJS.ErrnoException).code || 'error'}).`);
  process.exit(2);
}
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log(`Backup drill: ${file}`);
const result = await runBackupDrill(text, appRoot);
for (const s of result.steps) console.log(`  ${s.ok ? 'OK  ' : 'FAIL'} ${s.text}`);
console.log(result.ok ? 'PASS: this backup restores into a fresh install.' : 'FAIL: see the lines above.');
process.exit(result.ok ? 0 : 1);
