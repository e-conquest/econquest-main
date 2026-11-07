import type express from 'express';
import crypto from 'crypto';
import type { Account } from '../../utils/auth';
import { DATA_DIR } from '../config';
import type { AnalysisDeps } from './analysis';
import { refusal } from '../../utils/permissions';
import { appendAudit } from '../../utils/auditStore';
import { AUDIT_FILES } from '../config';
import { CBPOL_AREA, CBPOL_NOT_COVERED } from '../../utils/bisPolicyRates';
import { SOVEREIGN_CATALOG } from '../../data/presetsAndBaselines.ts';
import { addDays, IDEA_METHOD, scoreIdea, summariseIdeas, validateIdea, valueOnOrBefore, type IdeaInput } from '../../utils/ideaJournal';
import { appendIdea, ideaFilePath, loadIdeas } from '../../utils/ideaStore';
import { fetchPolicyDaily } from '../feeds/rates';

/**
 * Trade idea journal (src/utils/ideaJournal.ts): log an idea, fixed and hashed on entry; every read
 * scores the ideas against the same free feeds (ECB reference rates, BIS daily policy rates).
 */
export interface IdeaDeps {
  quick: AnalysisDeps['quick'];
  seriesFor: AnalysisDeps['seriesFor'];
  refuseRemoteChange: (req: express.Request, res: express.Response) => boolean;
  signedIn: (res: express.Response) => Account | null;
}

const IDEA_FILE = ideaFilePath(DATA_DIR);

export function registerIdeaRoutes(app: express.Express, deps: IdeaDeps): void {
  const { quick, seriesFor, refuseRemoteChange, signedIn } = deps;
  const nameOf = (iso3: string) => SOVEREIGN_CATALOG.find((c) => c.iso3 === iso3)?.countryName || iso3;
  /** The published series an idea is scored on, or why there is none. */
  const seriesForIdea = async (iso3: string, instrument: IdeaInput['instrument']): Promise<{ target: string; points: Array<{ date: string; value: number }> } | { reason: string }> => {
    if (instrument === 'fx') {
      if (iso3 === 'USA') return { reason: 'The US dollar is the base currency, so there is no exchange rate against it' };
      const set = await seriesFor(iso3);
      const fx = set.series.find((x) => x.id === 'fx_per_usd');
      if (!fx || fx.freq !== 'daily' || !fx.points.length) return { reason: 'No daily ECB reference rate for this currency' };
      return { target: String(fx.unit || '').split(' ')[0] || iso3, points: fx.points };
    }
    const area = CBPOL_AREA[iso3];
    if (!area || CBPOL_NOT_COVERED.has(iso3)) return { reason: 'This central bank is not in the BIS policy rate data' };
    const daily = await quick(fetchPolicyDaily(area));
    if (!daily?.length) return { reason: 'The BIS daily policy rate history did not answer' };
    return { target: area, points: daily.map((p) => ({ date: p.period, value: p.pct })) };
  };

  app.get('/api/ideas', async (_req, res) => {
    const { ideas, badLines } = loadIdeas(IDEA_FILE);
    const today = new Date().toISOString().slice(0, 10);
    const cache = new Map<string, Promise<Awaited<ReturnType<typeof seriesForIdea>>>>();
    const scored = await Promise.all(
      ideas.map(async ({ idea, hashOk }) => {
        const key = `${idea.iso3}|${idea.instrument}`;
        if (!cache.has(key)) cache.set(key, seriesForIdea(idea.iso3, idea.instrument));
        const s = await cache.get(key)!;
        const score = 'points' in s ? scoreIdea(idea, s.points, today) : { status: 'no_data' as const, note: s.reason };
        return { idea, hashOk, name: nameOf(idea.iso3), score };
      }),
    );
    res.json({ ideas: scored.reverse(), summary: summariseIdeas(scored), badLines, file: 'data/local/ideas.jsonl', method: IDEA_METHOD });
  });

  app.post('/api/ideas', async (req, res) => {
    if (refuseRemoteChange(req, res)) return;
    const who = signedIn(res);
    if (who && who.role === 'viewer') return res.status(403).json({ error: refusal(who.role, 'analyst') });
    const b = req.body || {};
    const input: Partial<IdeaInput> = {
      iso3: String(b.iso3 || '').toUpperCase(),
      instrument: b.instrument,
      direction: b.direction,
      horizonDays: Number(b.horizonDays),
      ...(b.invalidationPct !== undefined && b.invalidationPct !== null && b.invalidationPct !== '' ? { invalidationPct: Number(b.invalidationPct) } : {}),
      thesis: typeof b.thesis === 'string' ? b.thesis.trim() : '',
      type: b.type,
    };
    const problems = validateIdea(input);
    if (problems.length) return res.status(400).json({ error: `The idea needs ${problems.join('; ')}.` });
    const s = await seriesForIdea(input.iso3!, input.instrument!);
    if (!('points' in s)) return res.status(400).json({ error: `Cannot log this idea: ${s.reason}.` });
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const entry = valueOnOrBefore(s.points, today);
    if (!entry) return res.status(400).json({ error: 'Cannot log this idea: no published value yet to use as the entry level.' });
    try {
      const idea = appendIdea(IDEA_FILE, {
        ...(input as IdeaInput),
        id: crypto.randomUUID(),
        loggedAt: now.toISOString(),
        author: who ? `${who.displayName} (${who.username})` : 'local user',
        target: s.target,
        entry,
        horizonDate: addDays(today, input.horizonDays!),
      });
      appendAudit(AUDIT_FILES, { kind: 'idea', summary: `Logged a ${idea.type} idea: ${idea.direction} ${idea.instrument === 'fx' ? idea.target : `${idea.target} policy rate`} to ${idea.horizonDate}`, detail: { id: idea.id, hash: idea.hash } });
      res.json({ ok: true, idea });
    } catch (error: any) {
      res.status(500).json({ error: `Could not save the idea (${error?.code || error?.message || 'unknown error'}).` });
    }
  });
}
