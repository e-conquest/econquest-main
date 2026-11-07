/**
 * Answer snapshot store (server only): hashing and the files under data/local/snapshots/, one JSON
 * file per answer (mode 600). Types and plain-word helpers are in answerSnapshot.ts.
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { canonicalJson } from './auditLog';
import { writeFileAtomic } from './atomicWrite';
import type { AgentDocument } from './agentDocument';
import {
  SNAPSHOT_VERSION,
  isSnapshotId,
  snapshotFigures,
  snapshotId,
  type AnswerSnapshot,
  type SnapshotDocument,
  type SnapshotInputs,
  type SnapshotOutput,
  type SnapshotSettings,
} from './answerSnapshot';

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Inputs and settings that decide the answer; the prompt hash is left out because it follows from them. */
export function inputsHash(inputs: SnapshotInputs, settings: Pick<SnapshotSettings, 'mode' | 'templateHash'>): string {
  return sha256(canonicalJson({ inputs, mode: settings.mode, templateHash: settings.templateHash }));
}

export function outputHash(output: SnapshotOutput): string {
  return sha256(canonicalJson({ brief: output.brief }));
}

/** Hash of each agent document; the chart is left out (it is drawn from the same figures and can be large). */
export function documentHashes(docs: AgentDocument[]): SnapshotDocument[] {
  return docs.map(({ chart: _chart, ...d }) => ({
    docId: d.id,
    agent: d.agentName,
    version: d.version,
    hash: sha256(canonicalJson(d)),
    figures: d.findings.reduce((n, f) => n + (f.figures?.length ?? 0), 0),
  }));
}

export function buildSnapshot(args: { inputs: SnapshotInputs; settings: SnapshotSettings; output: SnapshotOutput; documents?: AgentDocument[]; via: string; rerunOf?: string; now?: Date }): AnswerSnapshot {
  const createdAt = (args.now ?? new Date()).toISOString();
  const ih = inputsHash(args.inputs, args.settings);
  return {
    version: SNAPSHOT_VERSION,
    id: snapshotId(createdAt, ih),
    createdAt,
    via: args.via.slice(0, 120),
    ...(args.rerunOf ? { rerunOf: args.rerunOf } : {}),
    inputs: args.inputs,
    settings: args.settings,
    output: args.output,
    figures: snapshotFigures(args.inputs.answers),
    documents: documentHashes(args.documents ?? []),
    inputsHash: ih,
    outputHash: outputHash(args.output),
  };
}

/** Recomputes both hashes; the parts that no longer match what was stored. */
export function verifySnapshot(s: AnswerSnapshot): Array<'inputs' | 'output'> {
  const bad: Array<'inputs' | 'output'> = [];
  if (inputsHash(s.inputs, s.settings) !== s.inputsHash) bad.push('inputs');
  if (outputHash(s.output) !== s.outputHash) bad.push('output');
  return bad;
}

export function snapshotDir(dataDir: string): string {
  return path.join(dataDir, 'local', 'snapshots');
}

/** Writes the snapshot and returns it as saved (the id gets an x when one with the same id exists). */
export function saveSnapshot(dir: string, s: AnswerSnapshot): AnswerSnapshot {
  let id = s.id;
  // Two answers in the same millisecond on the same inputs: keep both.
  while (fs.existsSync(path.join(dir, `${id}.json`))) id += 'x';
  const saved = id === s.id ? s : { ...s, id };
  writeFileAtomic(path.join(dir, `${id}.json`), JSON.stringify(saved), 0o600);
  return saved;
}

function isSnapshot(v: unknown): v is AnswerSnapshot {
  const s = v as AnswerSnapshot;
  return Boolean(s && typeof s.id === 'string' && s.inputs && Array.isArray(s.inputs.answers) && s.settings && s.output && typeof s.inputsHash === 'string');
}

export function loadSnapshot(dir: string, id: string): AnswerSnapshot | null {
  if (!isSnapshotId(id.replace(/x+$/, ''))) return null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
    return isSnapshot(j) ? j : null;
  } catch {
    return null;
  }
}

/** Snapshot ids, newest first. */
export function listSnapshotIds(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json') && isSnapshotId(f.slice(0, -5).replace(/x+$/, '')))
      .map((f) => f.slice(0, -5))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}
