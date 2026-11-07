import fs from 'fs';
import path from 'path';

/**
 * Write a file so that a crash or power cut part-way through never leaves it half written:
 * the text goes to a temporary file beside it first, which then replaces the old file in one step.
 * Readers see either the previous file or the new one, never a broken mix.
 */
export function writeFileAtomic(file: string, text: string | Buffer, mode?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    fs.writeFileSync(tmp, text, mode === undefined ? undefined : { mode });
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // nothing more to clean up
    }
    throw error;
  }
}
