/**
 * Agent debate (Sam, 2026-11-05). After the agents answer, they challenge each other where their
 * readings on the same country pull different ways: cheap CDS against a large shock exposure,
 * tight policy against a weak currency, any call against a dated event that could overturn it.
 *
 * The challenges come from stated rules on the agents' own findings, so they need no AI and every
 * figure in them is an agent's figure. When an AI model is set up, it then writes the challenged
 * agent's reply and a moderator's view, held to the same number and stance checks as the summary.
 */
import { CDS_HIDDEN } from './cdsHidden';
import type { AgentAnswer, AgentFinding, AgentId } from './askCouncil';
import type { Stance, StanceDim } from './stanceCheck';

type StanceCall = Stance['call'];

export interface DebateChallenge {
  iso3: string;
  countryName: string;
  /** The agent raising the point. */
  from: AgentId;
  fromName: string;
  /** The agent whose call is challenged. */
  to: AgentId;
  toName: string;
  /** The challenged agent's call, in its own words. */
  claim: string;
  /** The counterpoint, built from the challenger's finding. */
  challenge: string;
  /** What evidence would settle it. */
  settle: string;
}

export interface DebateReply {
  /** Index into the challenges. */
  index: number;
  reply: string;
}

export interface DebateResult {
  challenges: DebateChallenge[];
  /** Null when no model answered; the challenges stand alone. */
  replies: DebateReply[] | null;
  verdict?: string;
  open?: string[];
  provider?: string;
  /** Sentences removed by the number or stance check. */
  removed?: string[];
  reason?: string;
}

const MAX_CHALLENGES = 6;
/** Spillover findings at or above this weight (1% of GDP or more) count as a large exposure. */
const LARGE_EXPOSURE = 0.2;
/** Calendar events this close can overturn a call. */
const NEAR_EVENT_DAYS = 30;

type Found = { answer: AgentAnswer; finding: AgentFinding };

const call = (f: AgentFinding | undefined, dim: StanceDim): StanceCall | undefined => f?.stance?.find((s) => s.dim === dim)?.call;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const trim = (s: string) => s.replace(/\s+$/, '').replace(/\.$/, '');

/** Days until the calendar finding's next event, read from its reading ("today", "tomorrow", "in N days"). */
function daysAhead(reading: string): number | undefined {
  if (/\(today/.test(reading)) return 0;
  if (/\(tomorrow/.test(reading)) return 1;
  const m = reading.match(/\(in (\d+) days/);
  return m ? Number(m[1]) : undefined;
}

export function findChallenges(answers: AgentAnswer[]): DebateChallenge[] {
  const byCountry = new Map<string, Partial<Record<AgentId, Found>>>();
  for (const a of answers) {
    if (a.id === 'doc') continue;
    for (const f of a.findings) {
      const row = byCountry.get(f.iso3) || {};
      row[a.id] = { answer: a, finding: f };
      byCountry.set(f.iso3, row);
    }
  }

  const out: DebateChallenge[] = [];
  for (const [iso3, row] of byCountry) {
    const any = Object.values(row)[0]!;
    const countryName = any.finding.countryName;
    const push = (from: Found, to: Found, challenge: string, settle: string) =>
      out.push({ iso3, countryName, from: from.answer.id, fromName: from.answer.name, to: to.answer.id, toName: to.answer.name, claim: trim(to.finding.reading), challenge, settle });

    const cds = call(row.rv?.finding, 'cds');
    const fx = call(row.fx?.finding, 'fx');
    const policy = call(row.cb?.finding, 'policy');
    const exposed = row.spill && row.spill.finding.weight >= LARGE_EXPOSURE && /^Most exposed/.test(row.spill.finding.reading);

    if (row.rv && row.spill && exposed && cds === 'cheap')
      push(row.spill, row.rv, `CDS may look cheap because it prices too little of a shock: ${lower(trim(row.spill.finding.reading))}.`, 'How far CDS moved in the last comparable shock, against the trade hit now.');
    if (row.rv && row.spill && exposed && cds === 'rich')
      push(row.spill, row.rv, `Rich CDS leaves little cushion if a shock lands: ${lower(trim(row.spill.finding.reading))}.`, 'Whether the shock is already in the price, from CDS moves on recent headlines.');
    if (row.rv && row.fx && cds === 'cheap' && fx === 'weak')
      push(row.fx, row.rv, `The real exchange rate is weak for its history (${lower(trim(row.fx.finding.reading))}); cheap CDS may be pricing the same stress, not offering value.`, 'Whether the currency weakness is a cause of the spread or a cushion for exports.');
    if (row.rv && row.fx && cds === 'rich' && fx === 'strong')
      push(row.fx, row.rv, `Both CDS and the currency are priced for good news (${lower(trim(row.fx.finding.reading))}); there is little room if it turns.`, 'What would break both at once, and how likely it is.');
    if (row.fx && row.spill && exposed && fx === 'weak')
      push(row.spill, row.fx, `A currency weak for its history can look like room to recover, but a shock would push it the other way: ${lower(trim(row.spill.finding.reading))}.`, 'Reserves and the current account before the shock, against the size of the hit.');
    if (row.fx && row.spill && exposed && fx === 'strong')
      push(row.spill, row.fx, `A currency strong for its history has further to fall if a shock lands: ${lower(trim(row.spill.finding.reading))}.`, 'How the currency moved in the last comparable shock.');
    if (row.cb && row.fx && policy === 'tight' && fx === 'weak')
      push(row.fx, row.cb, `Policy reads tight, yet the real exchange rate is weak (${lower(trim(row.fx.finding.reading))}): either the tightening is recent or it is not enough to hold the currency.`, 'How long rates have been at this level, and the direction of reserves.');
    if (row.cb && row.rv && policy === 'loose' && cds === 'rich')
      push(row.rv, row.cb, `CDS is rich while policy reads loose; the market is not charging for the policy risk the Central Bank Watcher sees.`, 'Whether inflation expectations are drifting, from surveys or breakevens.');

    const days = row.calendar ? daysAhead(row.calendar.finding.reading) : undefined;
    if (row.calendar && days !== undefined && days <= NEAR_EVENT_DAYS) {
      // Challenge the strongest stanced call on this country.
      const target = [row.cb, row.rv, row.fx].filter((x): x is Found => Boolean(x?.finding.stance?.length)).sort((a, b) => b.finding.weight - a.finding.weight)[0];
      if (target)
        push(row.calendar, target, `This call may not hold past the next dated event. ${trim(row.calendar.finding.reading)}.`, 'The outcome of that event; revisit the call after it.');
    }
  }
  return out.slice(0, MAX_CHALLENGES);
}

export const DEBATE_INSTRUCTION = [
  'You moderate a debate between agents of a sovereign research council.',
  'For each numbered challenge, write the challenged agent\'s reply in one or two sentences, in the first person, using ONLY the agent findings given.',
  'The reply may concede, partly concede, or hold its ground, and must say which.',
  'Then write a verdict of one or two sentences on where the debate lands, and list what stays open.',
  'Every number you write must appear in the findings. Do not compute new numbers, forecast, or add outside facts.',
  'Keep each agent\'s stance in its own fixed words (policy tight, neutral or loose; ' + (CDS_HIDDEN ? 'cheap, in line or rich against peers' : 'CDS cheap, in line or rich') + '; real exchange rate strong, near average or weak).',
  'Plain English, no advice to buy or sell.',
].join(' ');

export function challengesAsText(challenges: DebateChallenge[]): string {
  return [
    'Challenges:',
    ...challenges.map(
      (c, i) => `${i + 1}. ${c.countryName}: the ${c.fromName} Agent challenges the ${c.toName} Agent. ${c.toName} Agent said: "${c.claim}". Challenge: ${c.challenge} What would settle it: ${c.settle}`
    ),
    '',
  ].join('\n');
}
