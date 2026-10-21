import { rmSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import type { FullConfig } from '@playwright/test';

export default function cleanup(config: FullConfig) {
  const directory: unknown = config.metadata.e2eDirectory;
  if (typeof directory !== 'string' || dirname(directory) !== tmpdir() || !basename(directory).startsWith('econquest-e2e-')) {
    throw new Error('Refusing cleanup outside the explicitly created E2E directory.');
  }
  rmSync(directory, { recursive: true });
}
