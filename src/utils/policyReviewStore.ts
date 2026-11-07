/**
 * Policy review store (server only): hashing each step, saving steps in order and the file
 * data/local/reviews.json (mode 600). Types and states are in policyReview.ts.
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { canonicalJson } from './auditLog';
import { writeFileAtomic } from './atomicWrite';
import { MAX_REVIEWS, MAX_RUNS, REVIEW_STEPS, REVIEW_TEMPLATE_VERSION, canSaveStep, frameTitle, prevStep, type PolicyReview, type ReviewFile, type ReviewFrame, type ReviewRun, type ReviewStep, type ReviewStepRecord } from './policyReview';

export function stepHash(step: ReviewStep, content: unknown, basedOn: string | undefined): string {
  return createHash('sha256').update(canonicalJson({ step, content, basedOn: basedOn ?? null })).digest('hex');
}

/** Saves one step's content, chained to the step before. Later steps keep their content but read "Out of date". */
export function saveStep(review: PolicyReview, step: ReviewStep, content: unknown, now: Date = new Date(), note?: string): { review: PolicyReview } | { error: string } {
  const blocked = canSaveStep(review, step);
  if (blocked) return { error: blocked };
  const prev = prevStep(step);
  const basedOn = prev ? review.steps[prev]!.hash : undefined;
  const at = now.toISOString();
  const hash = stepHash(step, content, basedOn);
  const rec: ReviewStepRecord = { content, savedAt: at, hash, ...(basedOn ? { basedOn } : {}) };
  const run: ReviewRun = { step, at, hash, ...(note ? { note: note.slice(0, 200) } : {}) };
  const title = step === 'frame' ? frameTitle(content as ReviewFrame) : review.title;
  return { review: { ...review, title, updatedAt: at, steps: { ...review.steps, [step]: rec }, runs: [...review.runs, run].slice(-MAX_RUNS) } };
}

/** A new review from a checked frame. */
export function newReview(frame: ReviewFrame, existingIds: string[], now: Date = new Date(), previousId?: string): PolicyReview {
  const at = now.toISOString();
  let id = `r-${at.replace(/[^0-9]/g, '')}`;
  while (existingIds.includes(id)) id += 'x';
  const empty: PolicyReview = { id, title: frameTitle(frame), templateVersion: REVIEW_TEMPLATE_VERSION, createdAt: at, updatedAt: at, ...(previousId ? { previousId } : {}), steps: {}, runs: [] };
  const out = saveStep(empty, 'frame', frame, now);
  return 'review' in out ? out.review : empty;
}

/** Checks every stored hash against the content. Returns the steps whose content no longer matches. */
export function verifyReview(review: PolicyReview): ReviewStep[] {
  return REVIEW_STEPS.filter((s) => {
    const rec = review.steps[s];
    return rec ? stepHash(s, rec.content, rec.basedOn) !== rec.hash : false;
  });
}

function isReview(v: unknown): v is PolicyReview {
  const r = v as PolicyReview;
  return Boolean(r && typeof r.id === 'string' && r.id && typeof r.title === 'string' && r.steps && typeof r.steps === 'object' && Array.isArray(r.runs));
}

export function reviewFilePath(dataDir: string): string {
  return path.join(dataDir, 'local', 'reviews.json');
}

export function loadReviews(file: string): ReviewFile {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { reviews: Array.isArray(j?.reviews) ? j.reviews.filter(isReview) : [] };
  } catch {
    return { reviews: [] };
  }
}

/** Saves one review (same id replaces), newest first. */
export function putReview(file: string, review: PolicyReview): void {
  const all = loadReviews(file);
  const reviews = [review, ...all.reviews.filter((r) => r.id !== review.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_REVIEWS);
  writeFileAtomic(file, JSON.stringify({ reviews }, null, 1), 0o600);
}

export function deleteReview(file: string, id: string): boolean {
  const all = loadReviews(file);
  if (!all.reviews.some((r) => r.id === id)) return false;
  writeFileAtomic(file, JSON.stringify({ reviews: all.reviews.filter((r) => r.id !== id) }, null, 1), 0o600);
  return true;
}
