import type { UserOption, OptionsStep as OptionsStepT } from '../../utils/reviewOptions';
import type { ReviewFrame } from '../../utils/policyReview';
import type { AIRuntimeConfig } from '../../types/council';
import type { Account } from '../../utils/auth';
import type { OpenDataSnapshot } from '../../types/council';
import { DATA_DIR } from '../config';
import type { AnalysisDeps } from './analysis';
import { archiveRoot } from '../../utils/pullArchive';
import { AUDIT_FILES, RESEARCH_FILE, REVIEW_FILE, SIGNOFF_FILE, VALIDATION_FILE } from '../../server/config';
import crypto from 'crypto';
import { refusal } from '../../utils/permissions';
import { loadLibrary } from '../../utils/researchStore';
import { appendAudit } from '../../utils/auditStore';
import { loadValidation } from '../../utils/backtestRun';
import { loadSignOffs, recordFor, reportHash, saveSignOff, signOffView, takeStep, SIGNOFF_LABEL } from '../../utils/signoff';
import { buildDiagnosis, type Diagnosis } from '../../utils/reviewDiagnosis';
import { buildMemo, parseMemoInputs, type MemoStep } from '../../utils/reviewMemo';
import { buildOutcomes } from '../../utils/reviewOutcomes';
import { cutAt, EPISODE_METHOD, EVIDENCE_TEMPLATE_VERSION, isResearchOnly, packRequests, pastEpisodes, perOption, runAnalysis, signalsFor, type EvidenceStep } from '../../utils/reviewEvidence';
import { OPTIONS_INSTRUCTION, OPTIONS_TEMPLATE_VERSION, optionsPrompt, parseUserOptions, unassessedOptions, type OptionsStep } from '../../utils/reviewOptions';
import { frameOf, parseFrame, summarise as summariseReview, stepStates, REVIEW_TEMPLATE_VERSION } from '../../utils/policyReview';
import { deleteReview, loadReviews, newReview, putReview, saveStep, verifyReview } from '../../utils/policyReviewStore';
import { figureRows } from '../../utils/csvExport';
import { listArchivedDays } from '../../utils/pullArchive';
import express from 'express';

type FetchedSeriesLike = { id: string; label: string; unit: string; freq: string; source: string; points: Array<{ date: string; value: number }> };
const ARCHIVE_DIR = archiveRoot(DATA_DIR);

/**
 * Policy reviews (the six-step case file, src/utils/policyReview.ts) and report sign-offs. Moved out
 * of server.ts unchanged; what they need from the server comes in through ReviewDeps.
 */
export interface ReviewDeps {
  refuseRemoteChange: (req: express.Request, res: express.Response) => boolean;
  signedIn: (res: express.Response) => Account | null;
  archivedSnapshot: (iso3: string, date: string) => { date: string; pulledAt: string | number; incomplete: boolean; snapshot: OpenDataSnapshot } | null;
  seriesFor: AnalysisDeps['seriesFor'];
  fetchLiveOpenDataSnapshot: (iso3: string, countryNameHint?: string, opts?: { cacheOnly?: boolean; forceRefresh?: boolean }) => Promise<OpenDataSnapshot>;
  reviewOptionsStep: (
    frame: ReviewFrame,
    diagnosis: Diagnosis,
    userOptions: UserOption[],
    runtimeConfig: Partial<AIRuntimeConfig>
  ) => Promise<{ status: 502 | 503; error: string; model?: string } | { content: Pick<OptionsStepT, 'model' | 'options' | 'ranking' | 'gaps' | 'removed'>; step: { model?: string; temperature?: number; seed?: number } }>;
  withModelFigures: (d: Diagnosis) => Diagnosis;
}

export function registerReviewRoutes(app: express.Express, deps: ReviewDeps): void {
  const { refuseRemoteChange, signedIn, archivedSnapshot, seriesFor, fetchLiveOpenDataSnapshot, reviewOptionsStep, withModelFigures } = deps;
  // Report sign-off: where each saved council conversation stands, and one step at a time.
  app.get('/api/signoffs', (_req, res) => {
    const all = loadSignOffs(SIGNOFF_FILE);
    const briefs: Record<string, ReturnType<typeof signOffView>> = {};
    for (const b of loadLibrary(RESEARCH_FILE).briefs) briefs[b.id] = signOffView(recordFor(all, 'brief', b.id), reportHash(b as any));
    const reviews: Record<string, ReturnType<typeof signOffView>> = {};
    for (const r of loadReviews(REVIEW_FILE).reviews) if (r.steps.memo) reviews[r.id] = signOffView(recordFor(all, 'review', r.id), r.steps.memo.hash);
    res.json({ briefs, reviews, file: 'data/local/signoffs.json' });
  });
  app.post('/api/signoffs/brief/:id', (req, res) => {
    if (refuseRemoteChange(req, res)) return;
    // Approving is an Admin step once accounts exist (docs/RISK_AND_COMPLIANCE.md: the Approver).
    if (signedIn(res) && req.body?.step === 'approved' && signedIn(res)!.role !== 'admin') return res.status(403).json({ error: refusal(signedIn(res)!.role, 'admin') });
    const b = loadLibrary(RESEARCH_FILE).briefs.find((x) => x.id === req.params.id);
    if (!b) return res.status(404).json({ error: 'No saved conversation with that id.' });
    const hash = reportHash(b as any);
    const out = takeStep(recordFor(loadSignOffs(SIGNOFF_FILE), 'brief', b.id), 'brief', b.id, hash, req.body || {}, new Date(), signedIn(res) ?? undefined);
    if ('error' in out) return res.status(400).json({ error: out.error });
    try {
      saveSignOff(SIGNOFF_FILE, out.record);
    } catch (error: any) {
      return res.status(500).json({ error: `Could not save the sign-off (${error?.code || error?.message || 'unknown error'}).` });
    }
    const view = signOffView(out.record, hash);
    const verb = { reviewed: 'Reviewed', approved: out.entry.selfApproved ? 'Approved (self-approved, no second reviewer)' : 'Approved', withdrawn: 'Withdrew the sign-off on' }[out.entry.step];
    appendAudit(AUDIT_FILES, {
      kind: 'signoff',
      summary: `${verb} "${String(b.question).slice(0, 150)}" (${out.entry.by})`,
      detail: { id: b.id, step: out.entry.step, by: out.entry.by, contentHash: hash, status: SIGNOFF_LABEL[view.status], ...(out.entry.note ? { note: out.entry.note } : {}) },
    });
    res.json(view);
  });
  // Policy reviews: a guided case file per country and problem (src/utils/policyReview.ts).
  app.get('/api/reviews', (_req, res) => {
    res.json({ reviews: loadReviews(REVIEW_FILE).reviews.map(summariseReview), templateVersion: REVIEW_TEMPLATE_VERSION, file: 'data/local/reviews.json' });
  });
  app.get('/api/reviews/:id', (req, res) => {
    const r = loadReviews(REVIEW_FILE).reviews.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'No policy review with that id.' });
    res.json({ review: r, states: stepStates(r), changed: verifyReview(r) });
  });
  const writeReview = (res: express.Response, review: Parameters<typeof putReview>[1]): boolean => {
    try {
      putReview(REVIEW_FILE, review);
      return true;
    } catch (error: any) {
      res.status(500).json({ error: `Could not save the policy review (${error?.code || error?.message || 'unknown error'}).` });
      return false;
    }
  };
  app.post('/api/reviews', (req, res) => {
    if (refuseRemoteChange(req, res)) return;
    const parsed = parseFrame(req.body?.frame);
    if ('errors' in parsed) return res.status(400).json({ error: parsed.errors.join(' '), errors: parsed.errors });
    const existing = loadReviews(REVIEW_FILE).reviews;
    const previousId = typeof req.body?.previousId === 'string' && existing.some((r) => r.id === req.body.previousId) ? req.body.previousId : undefined;
    const review = newReview(parsed.frame, existing.map((r) => r.id), new Date(), previousId);
    if (!writeReview(res, review)) return;
    appendAudit(AUDIT_FILES, { kind: 'research', summary: `Started policy review "${review.title}"`, detail: { id: review.id, step: 'frame', hash: review.steps.frame?.hash, templateVersion: review.templateVersion, ...(previousId ? { previousId } : {}) } });
    res.json({ review, states: stepStates(review) });
  });
  app.put('/api/reviews/:id/frame', (req, res) => {
    if (refuseRemoteChange(req, res)) return;
    const r = loadReviews(REVIEW_FILE).reviews.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'No policy review with that id.' });
    const parsed = parseFrame(req.body?.frame);
    if ('errors' in parsed) return res.status(400).json({ error: parsed.errors.join(' '), errors: parsed.errors });
    const out = saveStep(r, 'frame', parsed.frame);
    if ('error' in out) return res.status(400).json({ error: out.error });
    if (!writeReview(res, out.review)) return;
    appendAudit(AUDIT_FILES, { kind: 'research', summary: `Changed the frame of policy review "${out.review.title}"`, detail: { id: r.id, step: 'frame', hash: out.review.steps.frame?.hash } });
    res.json({ review: out.review, states: stepStates(out.review) });
  });
  // Step 2: the standard indicators from the archived pull on or before the frame's As of day.
  app.post('/api/reviews/:id/diagnose', (req, res) => {
    if (refuseRemoteChange(req, res)) return;
    const r = loadReviews(REVIEW_FILE).reviews.find((x) => x.id === req.params.id);
    const frame = r && frameOf(r);
    if (!r || !frame) return res.status(404).json({ error: 'No policy review with that id.' });
    const days = listArchivedDays(ARCHIVE_DIR, frame.iso3);
    const past = archivedSnapshot(frame.iso3, frame.asOf);
    if (!past) {
      return res.status(409).json({
        error: days.length
          ? `No saved pull for ${frame.iso3} on or before ${frame.asOf}; the archive starts ${days[0]}. Change the As of day in the frame.`
          : `No saved pulls for ${frame.iso3} yet. Open the country once (or run Menu > Offline data) so the app saves a pull, then run Diagnose again.`,
        days,
      });
    }
    const pulledAt = new Date(past.pulledAt).toISOString();
    const diagnosis = withModelFigures(buildDiagnosis(figureRows({ ...past.snapshot, fetchedAt: pulledAt }), { iso3: frame.iso3, asOf: frame.asOf, pullDate: past.date, pulledAt, incomplete: past.incomplete }));
    const out = saveStep(r, 'diagnose', diagnosis);
    if ('error' in out) return res.status(400).json({ error: out.error });
    if (!writeReview(res, out.review)) return;
    appendAudit(AUDIT_FILES, {
      kind: 'research',
      summary: `Diagnosed policy review "${out.review.title}" from the ${past.date} pull`,
      detail: { id: r.id, step: 'diagnose', hash: out.review.steps.diagnose?.hash, pullDate: past.date, pulledAt, coverage: diagnosis.coverage, figures: diagnosis.figures.map((x) => ({ ref: x.ref, label: x.label, value: x.value, source: x.source, period: x.period, reason: x.reason || undefined })) },
    });
    res.json({ review: out.review, states: stepStates(out.review) });
  });
  // Step 3: the council proposes and ranks options from the frozen diagnosis (temperature 0, prompt hashed).
  app.post('/api/reviews/:id/options', async (req, res) => {
    if (refuseRemoteChange(req, res)) return;
    const r = loadReviews(REVIEW_FILE).reviews.find((x) => x.id === req.params.id);
    const frame = r && frameOf(r);
    if (!r || !frame) return res.status(404).json({ error: 'No policy review with that id.' });
    if (stepStates(r).diagnose !== 'done') return res.status(400).json({ error: 'Diagnose must be done first.' });
    const diagnosis = r.steps.diagnose!.content as Diagnosis;
    const userOptions = parseUserOptions(req.body?.userOptions);
    const ownOnly = req.body?.ownOnly === true;
    const prompt = optionsPrompt(frame, diagnosis, userOptions);
    const promptHash = crypto.createHash('sha256').update(OPTIONS_INSTRUCTION + '\n' + prompt).digest('hex');
    const base = { templateVersion: OPTIONS_TEMPLATE_VERSION, temperature: 0, promptHash, userOptions };
    let content: OptionsStep;
    if (ownOnly) {
      if (!userOptions.length) return res.status(400).json({ error: 'Add at least one option of your own, or ask the council.' });
      content = { ...base, model: null, options: unassessedOptions(userOptions), ranking: '', gaps: [], removed: [], reason: 'saved with your own options only; the council was not asked' };
    } else {
      const step = await reviewOptionsStep(frame, diagnosis, userOptions, req.body?.runtimeConfig || {});
      if (!('content' in step)) return res.status(step.status).json({ error: step.error });
      content = { ...base, ...step.content };
    }
    const out = saveStep(r, 'options', content);
    if ('error' in out) return res.status(400).json({ error: out.error });
    if (!writeReview(res, out.review)) return;
    appendAudit(AUDIT_FILES, {
      kind: 'council',
      summary: `Options for policy review "${out.review.title}"${content.model ? '' : ' (your own, not assessed)'}`,
      detail: { id: r.id, step: 'options', hash: out.review.steps.options?.hash, model: content.model, temperature: 0, promptHash, templateVersion: OPTIONS_TEMPLATE_VERSION, options: content.options.map((o) => o.title), userOptions: userOptions.length, removedSentences: content.removed.length },
    });
    res.json({ review: out.review, states: stepStates(out.review) });
  });
  // Step 4: the evidence pack (charts and tests, past episodes, validation status), all cut at the As of day.
  app.post('/api/reviews/:id/evidence', async (req, res) => {
    if (refuseRemoteChange(req, res)) return;
    const r = loadReviews(REVIEW_FILE).reviews.find((x) => x.id === req.params.id);
    const frame = r && frameOf(r);
    if (!r || !frame) return res.status(404).json({ error: 'No policy review with that id.' });
    if (stepStates(r).options !== 'done') return res.status(400).json({ error: 'Options must be done first.' });
    const options = r.steps.options!.content as OptionsStep;
    const set = await seriesFor(frame.iso3);
    const countryName = (await fetchLiveOpenDataSnapshot(frame.iso3, undefined, { cacheOnly: true }).catch(() => null))?.countryName || frame.iso3;
    const fetchOne = (id: string): FetchedSeriesLike | { reason: string } => {
      const hit = set.series.find((x) => x.id === id);
      if (hit) {
        const cut = cutAt(hit, frame.asOf);
        return cut.points.length ? cut : { reason: `no points on or before ${frame.asOf}` };
      }
      return { reason: set.missing.find((m) => m.id === id)?.reason || 'the app holds no history for it yet' };
    };
    const analyses = packRequests({ iso3: frame.iso3, countryName }).map(({ id, informs, req: chart }) => {
      const fetched = chart.series.map((ref) => {
        const first = fetchOne(ref.id);
        return 'reason' in first && ref.fallback ? (() => { const alt = fetchOne(ref.fallback!); return 'reason' in alt ? first : alt; })() : first;
      });
      return runAnalysis(id, informs, chart, fetched as any);
    });
    const policy = set.series.find((x) => x.id === 'policy_rate');
    const cpi = set.series.find((x) => x.id === 'cpi_monthly');
    const items = pastEpisodes(policy && cutAt(policy, frame.asOf), cpi && cutAt(cpi, frame.asOf), frame.asOf);
    const v = loadValidation(VALIDATION_FILE);
    const verdicts = Object.fromEntries(Object.entries(v.results).map(([k, x]) => [k, { status: x.status, verdict: x.verdict }]));
    const signals = signalsFor(options, verdicts);
    const content: EvidenceStep = {
      templateVersion: EVIDENCE_TEMPLATE_VERSION,
      asOf: frame.asOf,
      analyses,
      episodes: {
        items,
        method: EPISODE_METHOD,
        ...(policy ? { source: policy.source } : { missing: set.missing.find((m) => m.id === 'policy_rate')?.reason || 'No BIS policy rate history' }),
        ...(policy && !items.length ? { missing: `no policy-rate move at least a year before ${frame.asOf} in the history the app holds` } : {}),
      },
      signals,
      perOption: perOption(options, analyses, signals),
      researchOnly: isResearchOnly(signals),
    };
    const out = saveStep(r, 'evidence', content);
    if ('error' in out) return res.status(400).json({ error: out.error });
    if (!writeReview(res, out.review)) return;
    appendAudit(AUDIT_FILES, {
      kind: 'research',
      summary: `Evidence for policy review "${out.review.title}"`,
      detail: { id: r.id, step: 'evidence', hash: out.review.steps.evidence?.hash, asOf: frame.asOf, analyses: analyses.map((a) => ({ id: a.id, tests: a.tests.length, missing: a.missing.length, inputs: a.inputs })), episodes: items.length, signals: signals.map((s) => `${s.id}: ${s.statusLabel}`), researchOnly: content.researchOnly },
    });
    res.json({ review: out.review, states: stepStates(out.review) });
  });
  // Step 5: the memo, assembled from the saved steps and the principal's choices (no AI).
  app.post('/api/reviews/:id/memo', (req, res) => {
    if (refuseRemoteChange(req, res)) return;
    const r = loadReviews(REVIEW_FILE).reviews.find((x) => x.id === req.params.id);
    const frame = r && frameOf(r);
    if (!r || !frame) return res.status(404).json({ error: 'No policy review with that id.' });
    if (stepStates(r).evidence !== 'done') return res.status(400).json({ error: 'Evidence must be done first.' });
    const parsed = parseMemoInputs(req.body, r.steps.options!.content as OptionsStep, frame.asOf);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const memo = buildMemo(r, parsed.inputs);
    const out = saveStep(r, 'memo', memo);
    if ('error' in out) return res.status(400).json({ error: out.error });
    if (!writeReview(res, out.review)) return;
    appendAudit(AUDIT_FILES, {
      kind: 'research',
      summary: `Wrote the memo for policy review "${out.review.title}"`,
      detail: { id: r.id, step: 'memo', hash: out.review.steps.memo?.hash, recommended: parsed.inputs.recommended, reviewDate: parsed.inputs.reviewDate, watch: parsed.inputs.watch, researchOnly: memo.researchOnly },
    });
    res.json({ review: out.review, states: stepStates(out.review) });
  });
  // Step 6: the same indicators from the latest saved pull, beside the figures the review started from.
  app.post('/api/reviews/:id/outcomes', (req, res) => {
    if (refuseRemoteChange(req, res)) return;
    const r = loadReviews(REVIEW_FILE).reviews.find((x) => x.id === req.params.id);
    const frame = r && frameOf(r);
    if (!r || !frame) return res.status(404).json({ error: 'No policy review with that id.' });
    if (stepStates(r).memo !== 'done') return res.status(400).json({ error: 'Write the memo first.' });
    const today = new Date().toISOString().slice(0, 10);
    const past = archivedSnapshot(frame.iso3, today);
    if (!past) return res.status(409).json({ error: `No saved pull for ${frame.iso3} yet. Open the country so the app saves one, then check again.` });
    const pulledAt = new Date(past.pulledAt).toISOString();
    const now = withModelFigures(buildDiagnosis(figureRows({ ...past.snapshot, fetchedAt: pulledAt }), { iso3: frame.iso3, asOf: today, pullDate: past.date, pulledAt, incomplete: past.incomplete }));
    const content = buildOutcomes(frame, r.steps.diagnose!.content as Diagnosis, now, r.steps.memo!.content as MemoStep, today);
    const out = saveStep(r, 'outcomes', content);
    if ('error' in out) return res.status(400).json({ error: out.error });
    if (!writeReview(res, out.review)) return;
    appendAudit(AUDIT_FILES, {
      kind: 'research',
      summary: `Checked outcomes of policy review "${out.review.title}" (${content.goal.move.replace(/_/g, ' ')})`,
      detail: { id: r.id, step: 'outcomes', hash: out.review.steps.outcomes?.hash, pullDate: past.date, early: content.early, goal: content.goal },
    });
    res.json({ review: out.review, states: stepStates(out.review) });
  });
  // Sign-off on a review's memo: same steps as a saved report, on the memo step's hash.
  app.post('/api/signoffs/review/:id', (req, res) => {
    if (refuseRemoteChange(req, res)) return;
    // Approving is an Admin step once accounts exist (docs/RISK_AND_COMPLIANCE.md: the Approver).
    if (signedIn(res) && req.body?.step === 'approved' && signedIn(res)!.role !== 'admin') return res.status(403).json({ error: refusal(signedIn(res)!.role, 'admin') });
    const r = loadReviews(REVIEW_FILE).reviews.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'No policy review with that id.' });
    if (stepStates(r).memo !== 'done') return res.status(400).json({ error: 'Write the memo first (and run it again if it is out of date).' });
    const hash = r.steps.memo!.hash;
    const out = takeStep(recordFor(loadSignOffs(SIGNOFF_FILE), 'review', r.id), 'review', r.id, hash, req.body || {}, new Date(), signedIn(res) ?? undefined);
    if ('error' in out) return res.status(400).json({ error: out.error });
    try {
      saveSignOff(SIGNOFF_FILE, out.record);
    } catch (error: any) {
      return res.status(500).json({ error: `Could not save the sign-off (${error?.code || error?.message || 'unknown error'}).` });
    }
    const view = signOffView(out.record, hash);
    const verb = { reviewed: 'Reviewed', approved: out.entry.selfApproved ? 'Approved (self-approved, no second reviewer)' : 'Approved', withdrawn: 'Withdrew the sign-off on' }[out.entry.step];
    appendAudit(AUDIT_FILES, {
      kind: 'signoff',
      summary: `${verb} the memo of policy review "${r.title.slice(0, 150)}" (${out.entry.by})`,
      detail: { reviewId: r.id, step: out.entry.step, by: out.entry.by, contentHash: hash, status: SIGNOFF_LABEL[view.status], ...(out.entry.note ? { note: out.entry.note } : {}) },
    });
    res.json(view);
  });
  app.delete('/api/reviews/:id', (req, res) => {
    if (refuseRemoteChange(req, res)) return;
    const r = loadReviews(REVIEW_FILE).reviews.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'No policy review with that id.' });
    if (r.steps.memo && signOffView(recordFor(loadSignOffs(SIGNOFF_FILE), 'review', r.id), r.steps.memo.hash).status === 'approved') {
      return res.status(409).json({ error: 'This review\'s memo is approved. Withdraw the approval first, then delete it.' });
    }
    try {
      deleteReview(REVIEW_FILE, r.id);
    } catch (error: any) {
      return res.status(500).json({ error: `Could not delete the policy review (${error?.code || error?.message || 'unknown error'}).` });
    }
    appendAudit(AUDIT_FILES, { kind: 'research', summary: `Deleted policy review "${r.title}"`, detail: { id: r.id } });
    res.json({ ok: true });
  });
}
