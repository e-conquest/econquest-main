/** File storage for the research library (server only): data/local/research.json, mode 600. */
import fs from 'fs';
import path from 'path';
import { EMPTY_LIBRARY, parseLibrary, type ResearchLibrary } from './researchLibrary';

export function researchFilePath(dataDir: string): string {
  return path.join(dataDir, 'local', 'research.json');
}

export function loadLibrary(file: string): ResearchLibrary {
  try {
    return parseLibrary(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return { ...EMPTY_LIBRARY };
  }
}

export function saveLibrary(file: string, lib: ResearchLibrary): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(lib), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // not supported on this file system (Windows): the file is still outside the repo
  }
}
