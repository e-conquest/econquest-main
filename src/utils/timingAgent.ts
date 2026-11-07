/**
 * Timing Agent (Sam, 2026-11-05): helps judge WHEN a trend or shock might play out, from figures the
 * app already pulls. For each country it lines up:
 * - Catalysts: dated events on the official calendar in the next 60 days.
 * - Cycle clock: policy cycle (BIS moves) and business cycle (OECD leading indicator, last turn).
 * - Positioning: CFTC leveraged-fund crowding and its 4-week change (crowded and turning = unwind setup).
 * - News: the GDELT tone shift (latest week against the earlier weeks of the same pull).
 * - Prediction markets: Polymarket contracts naming the country whose odds moved 10 pts or more in a week.
 * - Flows: TIC holdings of US Treasuries over 12 months.
 * - Markets: the 3-month change in the official 10Y yield.
 * It describes the setup with dates. It never gives a probability or says what will happen.
 */
import type { LiveWatchlistItem } from '../types/council';
import type { AgentAnswer, AgentFigure, AgentFinding } from './askCouncil';
import { upcomingOfficialEvents, dateKindLabel } from '../data/officialCalendar';
import { cycleClock, cliCycleText, policyCycleText } from './cycleClock';
import { positioningLabel, ordinal } from './cftcPositioning';
import { toneTurn } from './gdeltTone';
import { ticTrend, formatMonth as ticMonth } from './ticHoldings';
import { formatPeriod } from './officialYields';
import { formatMonth } from './oecdSdmx';
import { shockSummary, shockWatch } from './shockWatch';
import { SMALL_SAMPLE } from './signalRecord';
import { fastestOddsMove, oddsMoveText } from './oddsMoves';

export const TIMING_AGENT_NAME = 'Timing';
export const TIMING_HORIZON_DAYS = 60;
/** A CFTC 4-week move at least this large (points of open interest) counts as turning. */
export const CFTC_TURN_PTS = 3;
/** A leading-indicator turn or a first policy move this recent counts as fresh. */
export const FRESH_MONTHS = 3;

const sg = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`;
const monthsBetween = (from: string, to: string) => {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
};

export interface TimingSignal {
  key: 'catalyst' | 'policy' | 'cycle' | 'positioning' | 'news' | 'odds' | 'flows' | 'yield' | 'shock';
  text: string;
  /** True when this signal points to something changing now (a turn, an unwind, a shift), not a steady state. */
  pressure: boolean;
}

export function timingSignals(it: LiveWatchlistItem, now: Date): { signals: TimingSignal[]; figures: AgentFigure[]; missing: string[]; nextDays?: number } {
  const signals: TimingSignal[] = [];
  const figures: AgentFigure[] = [];
  const missing: string[] = [];
  // Catalysts
  const events = upcomingOfficialEvents([it.iso3], TIMING_HORIZON_DAYS, now).slice(0, 3);
  if (events.length) {
    const e = events[0];
    const when = e.daysUntil === 0 ? 'today' : e.daysUntil === 1 ? 'tomorrow' : `in ${e.daysUntil} days`;
    signals.push({ key: 'catalyst', text: `Next dated catalyst: ${e.title} on ${e.date} (${when}${e.dateKind ? ', latest date in law' : ''}).`, pressure: false });
    for (const ev of events)
      figures.push({ label: ev.title, value: `${ev.date}${dateKindLabel(ev) ? ` (${dateKindLabel(ev)})` : ''}`, source: `${ev.sourceName}${ev.primarySource ? '' : ', secondary source'}`, tag: 'official' });
  } else missing.push(`${it.countryName}: no dated event on file in the next ${TIMING_HORIZON_DAYS} days`);

  // Cycle clock
  const clock = cycleClock(it, now);
  if (clock.policy) {
    const p = clock.policy;
    const fresh = p.state !== 'on hold' && p.movesInRun === 1 && (p.monthsSinceLastMove ?? 99) < FRESH_MONTHS;
    signals.push({ key: 'policy', text: `${policyCycleText(p)}${fresh ? ' (a first move in this direction: a possible turn in the cycle)' : ''}.`, pressure: fresh });
    figures.push({ label: 'Policy cycle', value: p.state, source: `BIS policy-rate moves to ${formatPeriod(p.asOf)}; no move for 6 months = on hold`, tag: 'model' });
  } else missing.push(`${it.countryName}: no BIS policy-rate history for the policy cycle`);
  if (clock.cli) {
    const t = clock.cli.lastTurn;
    const fresh = !!t && monthsBetween(t.month, clock.cli.month) < FRESH_MONTHS + 1;
    const rec = it.signalRecord?.cliTurnToPolicy;
    const recText = fresh && rec ? ` Here, a turn was followed by a matching policy move ${rec.followed} of ${rec.tested} times since ${formatMonth(rec.from)}${rec.tested < SMALL_SAMPLE ? ' (too few to lean on)' : ''}.` : '';
    signals.push({ key: 'cycle', text: `Leading indicator: ${cliCycleText(clock.cli)}${fresh ? '. The turn is recent' : ''}.${recText}`, pressure: fresh });
    figures.push({ label: 'Leading indicator phase', value: clock.cli.phase, source: `OECD CLI via DBnomics, ${formatMonth(clock.cli.month)}`, tag: 'official' });
    if (t) figures.push({ label: 'Last turning point', value: `${t.kind}, ${formatMonth(t.month)} (${t.level.toFixed(2)})`, source: 'OECD CLI; two months each way', tag: 'model' });
  } else missing.push(`${it.countryName}: no OECD leading indicator`);

  // Positioning
  const c = it.cftc;
  if (c?.percentile !== undefined) {
    const label = positioningLabel(c.percentile);
    const chg = c.levNetPctOiChange4w;
    const turning =
      label !== 'not stretched' && chg !== undefined && ((label === 'crowded long' && chg <= -CFTC_TURN_PTS) || (label === 'crowded short' && chg >= CFTC_TURN_PTS));
    const chgText = chg !== undefined ? `, ${sg(chg)} pts of open interest over 4 weeks` : '';
    signals.push({
      key: 'positioning',
      text:
        label === 'not stretched'
          ? `Futures positioning in the ${c.ccy} is not stretched (${ordinal(c.percentile)} percentile of 3 years${chgText}).`
          : turning
            ? `Leveraged funds are ${label} the ${c.ccy} (${ordinal(c.percentile)} percentile) and have started to cut${chgText}: the setup in which a crowded position unwinds.`
            : `Leveraged funds are ${label} the ${c.ccy} (${ordinal(c.percentile)} percentile${chgText}); a crowded position can unwind fast once it turns.`,
      pressure: turning,
    });
    const rec = it.signalRecord?.crowdingUnwind;
    if (label !== 'not stretched' && rec)
      figures.push({ label: 'Crowded episodes that unwound within 8 weeks', value: `${rec.followed} of ${rec.tested}`, source: `CFTC TFF ${rec.from} to ${rec.to}; bands set with hindsight${rec.tested < SMALL_SAMPLE ? '; too few to lean on' : ''}`, tag: 'model' });
    figures.push({ label: 'Leveraged funds net, % of open interest', value: `${sg(c.levNetPctOi)}% (${ordinal(c.percentile)} percentile)`, source: `CFTC TFF, report ${c.reportDate}`, tag: 'official' });
    if (chg !== undefined) figures.push({ label: '4-week change in positioning', value: `${sg(chg)} pts`, source: `CFTC TFF, to ${c.reportDate}`, tag: 'official' });
  } else if (!c) missing.push(`${it.countryName}: no CFTC currency future`);

  // News tone
  const g = it.gdelt;
  if (g?.toneShift) {
    const turn = toneTurn(g.toneShift.shift);
    signals.push({
      key: 'news',
      text: `News tone ${turn === 'steady' ? 'steady' : turn}: latest week ${g.toneShift.recent.toFixed(1)} against ${g.toneShift.earlier.toFixed(1)} over the ${g.toneShift.earlierDays} days before (GDELT, pulled ${g.pulledAt.slice(0, 10)}).`,
      pressure: turn === 'turning more negative',
    });
    figures.push({ label: 'News tone shift', value: `${sg(g.toneShift.shift, 2)} (latest week ${g.toneShift.recent.toFixed(2)})`, source: `GDELT tone timeline, pulled ${g.pulledAt.slice(0, 10)}`, tag: 'live' });
  } else if (g) missing.push(`${it.countryName}: GDELT tone has no shift yet (the next weekly pull adds it)`);
  else missing.push(`${it.countryName}: no GDELT pull`);

  // Prediction-market odds moving fast (Polymarket's own reported weekly change)
  const fast = fastestOddsMove(it.politics?.markets);
  if (fast) {
    signals.push({
      key: 'odds',
      text: `Prediction-market odds moving fast: "${fast.question}" at ${fast.probabilityPct}% yes, ${oddsMoveText(fast)} (Polymarket, pulled ${it.politics?.marketsPulledAt || 'today'}; market prices, not a forecast).`,
      pressure: true,
    });
    figures.push({ label: `Prediction market: ${fast.question}`, value: `${fast.probabilityPct}% yes; ${oddsMoveText(fast)}`, source: `Polymarket, pulled ${it.politics?.marketsPulledAt || 'today'}; market odds, not a forecast by the app`, tag: 'live' });
  }

  // Flows
  const t = it.tic;
  if (t?.change12mPct !== undefined) {
    const trend = ticTrend(t.change12mPct);
    signals.push({ key: 'flows', text: `US Treasury holdings ${sg(t.change12mPct)}% over 12 months to ${ticMonth(t.month)}: ${trend === 'steady' ? 'steady' : `${trend} Treasuries`}.`, pressure: trend === 'selling' });
    figures.push({ label: 'US Treasury holdings, 12-month change', value: `${sg(t.change12mPct)}%`, source: `US Treasury TIC, ${ticMonth(t.month)}`, tag: 'official' });
  }

  // Yield momentum
  if (it.yield10YChange3mPts !== undefined && it.yield10YPeriod) {
    const bps = Math.round(it.yield10YChange3mPts * 100);
    const big = Math.abs(bps) >= 50;
    signals.push({ key: 'yield', text: `10Y yield ${sg(bps, 0)} bps over 3 months to ${formatPeriod(it.yield10YPeriod)}${big ? ': a large move' : ''}.`, pressure: big && bps > 0 });
    figures.push({ label: '10Y yield, 3-month change', value: `${sg(bps, 0)} bps`, source: `official monthly average, ${formatPeriod(it.yield10YPeriod)}`, tag: 'official' });
  }

  // Shock early warning: external and market pressure rules (alerts count as change underway).
  const sw = shockWatch(it);
  const alerts = sw.warnings.filter((x) => x.level === 'alert');
  if (sw.warnings.length) {
    signals.push({
      key: 'shock',
      text: `Shock early warning: ${shockSummary(sw)} (${sw.warnings.map((x) => x.label.toLowerCase()).join('; ')}).`,
      pressure: alerts.length > 0,
    });
    for (const x of sw.warnings) figures.push({ label: `${x.level === 'alert' ? 'Alert' : 'Watch'}: ${x.label}`, value: x.detail, source: `rule: ${x.rule}`, tag: 'model' });
  }

  return { signals, figures, missing, ...(events.length ? { nextDays: events[0].daysUntil } : {}) };
}

/** Plain-words summary: how many signals point to change now, and whether a dated catalyst is close. */
export function timingSetup(signals: TimingSignal[], nextDays?: number): string {
  const pressing = signals.filter((s) => s.pressure).map((s) => s.key);
  const names: Record<TimingSignal['key'], string> = {
    catalyst: 'catalyst',
    policy: 'a fresh policy turn',
    cycle: 'a recent leading-indicator turn',
    positioning: 'crowded positioning starting to unwind',
    news: 'news tone turning more negative',
    odds: 'prediction-market odds moving fast',
    flows: 'Treasury selling',
    yield: 'a large rise in the 10Y yield',
    shock: 'a shock early-warning alert',
  };
  const near = nextDays !== undefined && nextDays <= 30;
  if (!pressing.length) return near ? `No signal points to a change underway; the next dated catalyst is ${nextDays} days away.` : 'No signal points to a change underway.';
  const list = pressing.map((k) => names[k]).join(', ');
  return `${pressing.length} signal${pressing.length === 1 ? '' : 's'} point to change underway (${list})${near ? `, with a dated catalyst ${nextDays === 0 ? 'today' : `in ${nextDays} days`}` : ''}.`;
}

export function timingAgent(countries: LiveWatchlistItem[], now: Date): Omit<AgentAnswer, 'why'> {
  const findings: AgentFinding[] = [];
  const missing: string[] = [];
  for (const it of countries) {
    const s = timingSignals(it, now);
    missing.push(...s.missing);
    if (!s.signals.length) continue;
    const pressing = s.signals.filter((x) => x.pressure).length;
    const near = s.nextDays !== undefined ? 1 / (1 + s.nextDays / 30) : 0;
    findings.push({
      iso3: it.iso3,
      countryName: it.countryName,
      reading: `${timingSetup(s.signals, s.nextDays)} ${s.signals.map((x) => x.text).join(' ')} These are signals in the data, not a forecast.`,
      figures: s.figures,
      weight: Math.min(1, pressing / 3 + near * 0.3),
    });
  }
  return { id: 'timing', name: TIMING_AGENT_NAME, findings, missing };
}
