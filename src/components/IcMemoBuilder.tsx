import { withNoteReferences } from '../utils/citations';
import { approvalText, coherenceText, modelCouncil, riskPctText } from '../utils/councilResult';
import React, { useMemo, useState } from 'react';
import { Copy, Download, Printer } from 'lucide-react';
import type { CouncilAssessmentRun, LiveWatchlistItem } from '../types/council';
import type { StagedTradeTicketSpec } from '../utils/nssYieldCurveAndCatalystEngine';
import { getSnapshotDataStatus, DATA_MODE_LABEL, formatAsOf, type SnapshotDataStatus } from '../utils/dataStatus';
import { describeOfficialYield, formatPeriod } from '../utils/officialYields';
import { summariseBook, type Holding } from '../utils/holdings';
import { upcomingOfficialEvents } from '../data/officialCalendar';
import { toDisplayCase } from '../utils/displayCase';
import { buildEconomistSections, ECONOMIST_SECTIONS, pathMissing } from '../utils/countryNotes';
import { councilInputs } from '../utils/councilInputs';

const PATH_LABEL: Record<string, string> = {
  'imf.debtToGdpPct': 'debt/GDP',
  'imf.realGdpGrowthPct': 'growth',
  'imf.cpiInflationPct': 'inflation',
  'imf.primaryFiscalBalancePct': 'primary balance',
  'wb.fxReservesMonthsImport': 'reserves',
};
import { buildBankerSections, BANKER_SECTIONS } from '../utils/bankerNote';
import { buildOfficialSections, OFFICIAL_SECTIONS } from '../utils/officialNote';
import { COUNCIL_SECTIONS, councilBriefSections, loadCouncilBrief } from '../utils/askCouncil';
import { BOOK_SECTIONS, bookView, buildBookSections, buildClientReviewSections, CLIENT_REVIEW_SECTIONS } from '../utils/bookNote';
import { withNotice } from '../utils/disclaimer';

/**
 * One builder for the investment committee memo. It pulls the current country view,
 * staged tickets, imported holdings and the official calendar into a draft the user can
 * edit, then copy, download as Markdown, or print to PDF. Every figure carries its data status.
 */

export interface IcMemoBuilderProps {
  run: CouncilAssessmentRun;
  stagedTickets: StagedTradeTicketSpec[];
  holdings: Holding[];
  riskLookup: LiveWatchlistItem[];
  /** The watchlist, for the issuer note's peer comparison. Defaults to riskLookup. */
  peers?: LiveWatchlistItem[];
  /** Which version opens first. Private wealth advisers start on the client note. */
  defaultAudience?: MemoAudience;
  /** Templates to offer. Defaults to all of them. */
  audiences?: MemoAudience[];
}

/**
 * 'ic' = internal investment committee memo; 'client' = plain-language note for a private client;
 * 'economist' = country economic note (growth, policy, fiscal, external).
 */
export type MemoAudience = 'ic' | 'client' | 'economist' | 'banker' | 'official' | 'book' | 'client_review' | 'council';

export const AUDIENCE_INFO: Record<
  MemoAudience,
  { tab: string; title: string; heading: string; file: string; help: string; /** Covers the whole book, not the current country. */ bookLevel?: boolean }
> = {
  ic: { tab: 'Investment committee memo', title: 'IC memo', heading: 'Memo', file: 'ic-memo', help: 'Internal memo with trades, risk figures and kill switches.' },
  client: { tab: 'Client note', title: 'client note', heading: 'Client note', file: 'client-note', help: 'Plain language for a private client. No trade levels, scores or desk terms.' },
  economist: {
    tab: 'Country note',
    title: 'country note',
    heading: 'Country note',
    file: 'country-note',
    help: 'Economist’s note: growth, inflation and policy, the fiscal path and the external position. Every figure names its source.',
  },
  banker: {
    tab: 'Issuer note',
    title: 'issuer note',
    heading: 'Issuer note',
    file: 'issuer-note',
    help: 'Banker’s note on the sovereign as an issuer: market access, financing need, execution window and pricing against peers.',
  },
  official: {
    tab: 'Sustainability assessment',
    title: 'debt sustainability assessment',
    heading: 'Debt sustainability assessment',
    file: 'dsa',
    help: 'Official-sector assessment: debt path, five-year projection with standard shocks, fiscal adjustment, external position, and the method used.',
  },
  book: {
    tab: 'Portfolio review',
    title: 'Portfolio review',
    heading: 'Portfolio review',
    file: 'portfolio-review',
    help: 'Internal review of the whole book: concentration, where the risk sits, official events in the next 30 days and staged ideas.',
    bookLevel: true,
  },
  client_review: {
    tab: 'Client portfolio review',
    title: 'Client portfolio review',
    heading: 'Client portfolio review',
    file: 'client-portfolio-review',
    help: 'The client’s whole portfolio in plain language: what they hold, what could go wrong and dates to watch. No trade levels or scores.',
    bookLevel: true,
  },
  council: {
    tab: 'Council brief',
    title: 'Council brief',
    heading: 'Council brief',
    file: 'council-brief',
    help: 'The last question you asked the council on Workspace: the agents’ answers with their sources, and the synthesis agent’s summary if a model is set up.',
    bookLevel: true,
  },
};

export type SectionId = 'recommendation' | 'figures' | 'thesis' | 'trades' | 'portfolio' | 'risks' | 'calendar' | 'sources';

export const SECTION_LABEL: Record<SectionId, string> = {
  recommendation: 'Recommendation',
  figures: 'Key figures',
  thesis: 'Thesis',
  trades: 'Proposed trades',
  portfolio: 'Portfolio impact',
  risks: 'Risks and kill switch',
  calendar: 'Coming up',
  sources: 'Data and sources',
};

/** Headings for the client note. Trades and kill switches are internal, so the client note has no trades section. */
export const CLIENT_SECTION_LABEL: Partial<Record<SectionId, string>> = {
  recommendation: 'Our view',
  thesis: 'Why we think this',
  portfolio: 'What it means for your portfolio',
  figures: 'Key numbers',
  risks: 'What could go wrong',
  calendar: 'Dates to watch',
  sources: 'Important information',
};

export const sectionLabels = (audience: MemoAudience): Record<string, string> =>
  audience === 'economist'
    ? ECONOMIST_SECTIONS
    : audience === 'banker'
      ? BANKER_SECTIONS
      : audience === 'official'
        ? OFFICIAL_SECTIONS
        : audience === 'book'
          ? BOOK_SECTIONS
          : audience === 'client_review'
            ? CLIENT_REVIEW_SECTIONS
            : audience === 'council'
              ? COUNCIL_SECTIONS
            : ((audience === 'client' ? CLIENT_SECTION_LABEL : SECTION_LABEL) as Record<string, string>);

/** Sections for any audience. `include` lists sections switched off as false; anything absent is on. */
export function buildReportSections(
  p: IcMemoBuilderProps,
  include: Record<string, boolean>,
  ticketScope: 'country' | 'all',
  audience: MemoAudience
): Array<{ heading: string; lines: string[] }> {
  const on = (id: string) => include[id] !== false;
  if (audience === 'council') return councilBriefSections(loadCouncilBrief(), on);
  // Country notes: sourced figures get reference numbers and a References list (src/utils/citations.ts).
  const accessed = p.run.openData?.fetchedAt || new Date().toISOString();
  const cite = (sections: Array<{ heading: string; lines: string[] }>) => (on('references') ? withNoteReferences(sections, accessed) : sections);
  if (audience === 'economist') return cite(buildEconomistSections(p.run, on));
  if (audience === 'official') return cite(buildOfficialSections(p.run, on));
  if (audience === 'banker') return cite(buildBankerSections(p.run, p.peers ?? p.riskLookup, on));
  if (audience === 'book' || audience === 'client_review') {
    const v = bookView(p.holdings, p.riskLookup, p.peers ?? p.riskLookup);
    return audience === 'book' ? buildBookSections(v, p.stagedTickets, on) : buildClientReviewSections(v, on);
  }
  const all = Object.fromEntries((Object.keys(SECTION_LABEL) as SectionId[]).map((id) => [id, on(id)])) as Record<SectionId, boolean>;
  return buildSections(p, all, ticketScope, audience);
}

const CLIENT_VERDICT: Record<string, string> = {
  EXECUTE_TRADES: 'We see an opportunity here and think it is worth adding exposure, within your agreed limits.',
  DEFENSIVE_HEDGE: 'We are cautious. We think it is sensible to reduce or protect exposure here.',
  HOLD_AND_MONITOR: 'We would keep things as they are for now and watch closely.',
};

const VERDICT_LABEL: Record<string, string> = {
  EXECUTE_TRADES: 'Act: put on the proposed trades',
  DEFENSIVE_HEDGE: 'Defensive: hedge or reduce',
  HOLD_AND_MONITOR: 'Hold and monitor',
};

export interface MemoSection {
  id: SectionId;
  heading: string;
  lines: string[]; // each line is a paragraph, or a bullet when it starts with "- "
}

function yieldSourceNote(status: SnapshotDataStatus, fallback: string): string {
  return status.officialYield ? ` (${describeOfficialYield(status.officialYield).long})` : fallback;
}

export function buildSections(
  p: IcMemoBuilderProps,
  include: Record<SectionId, boolean>,
  ticketScope: 'country' | 'all',
  audience: MemoAudience = 'ic'
): MemoSection[] {
  if (audience === 'client') return buildClientSections(p, include);
  const { run, stagedTickets, holdings, riskLookup } = p;
  const open = run.openData;
  const sc = modelCouncil(run);
  const status = getSnapshotDataStatus(open);
  // Only real figures: anything else is named as missing, with the reason.
  const fig = (label: string, path: string, fmt: (v: number) => string, note = '') => {
    const v = status.live(path);
    return v === undefined ? `- ${label}: Missing (${pathMissing(status, path).short})` : `- ${label}: ${fmt(v)}${note}`;
  };
  const inputs = councilInputs(open);
  const tickets = ticketScope === 'country' ? stagedTickets.filter((t) => t.iso3 === run.iso3) : stagedTickets;
  const out: MemoSection[] = [];

  if (include.recommendation) {
    const lines = sc
      ? [
          `**${VERDICT_LABEL[sc.decisionVerdict] || sc.decisionVerdict}.** Stance: ${toDisplayCase(sc.marketTranslationLayer.regimeStance)}.`,
          inputs.deskEnginesLive
            ? `Composite risk score ${(sc.compositeRiskScore * 100).toFixed(0)} / 100; council agreement ${coherenceText(sc)}. Risk check: ${approvalText(sc.marketTranslationLayer.riskGuardianCheck.approvalStatus)}.`
            : `The council ran with figures missing (${inputs.missingDeskInputs.map((p) => PATH_LABEL[p] || p).join(', ')}), so its risk score is left out. Press Refresh now under Research > One country and re-run before taking this to committee.`,
        ]
      : ['No council run yet for this country. Run the council before taking this memo to committee.'];
    out.push({ id: 'recommendation', heading: SECTION_LABEL.recommendation, lines });
  }

  if (include.figures) {
    out.push({
      id: 'figures',
      heading: SECTION_LABEL.figures,
      lines: [
        fig('Debt / GDP', 'imf.debtToGdpPct', (v) => `${v.toFixed(1)}%`, ' (IMF WEO)'),
        fig('FX reserves, months of imports', 'wb.fxReservesMonthsImport', (v) => v.toFixed(1), ' (World Bank)'),
        fig('5Y CDS', 'market.cds5YSpreadBps', (v) => `${Math.round(v)} bps`, ` (${open.liveFields?.['market.cds5YSpreadBps'] || 'your data'})`),
        fig('10Y yield', 'market.sovereign10YBondYieldPct', (v) => `${v.toFixed(2)}%`, yieldSourceNote(status, '')),
        fig('Policy rate', 'market.policyRatePct', (v) => `${v.toFixed(2)}%`),
      ],
    });
  }

  if (include.thesis) {
    const lines: string[] = [];
    // Drop the inline formula references ("(Ref: ...)") used on screen; the memo is for people.
    const clean = (t: string) => t.replace(/\s*\(Ref:[^)]*\)/g, '').trim();
    if (sc?.executiveSummary) lines.push(clean(sc.executiveSummary));
    const vul = sc?.policyResearcherReport.structuralVulnerabilities || [];
    if (vul.length) lines.push(...vul.slice(0, 4).map((v) => `- ${clean(v)}`));
    if (!lines.length) lines.push('No thesis yet. Run the council or write the thesis here.');
    out.push({ id: 'thesis', heading: SECTION_LABEL.thesis, lines });
  }

  if (include.trades) {
    const lines = tickets.length
      ? tickets.map(
          (t) =>
            `- **${t.strategyTitle}** (${t.countryName}). Entry ${t.entrySpreadOrYieldBps} bps, target ${t.targetSpreadOrYieldBps}, stop ${t.stopLossSpreadOrYieldBps}. Expected 12M carry and roll ${t.expected12MCarryRollBps} bps; conviction ${t.convictionScore0To100}/100.`
        )
      : [
          ticketScope === 'country'
            ? `No staged trade tickets for ${run.countryName}. Stage one from a desk, or switch to all tickets.`
            : 'No staged trade tickets.',
        ];
    out.push({ id: 'trades', heading: SECTION_LABEL.trades, lines });
  }

  if (include.portfolio) {
    if (!holdings.length) {
      out.push({
        id: 'portfolio',
        heading: SECTION_LABEL.portfolio,
        lines: ['No holdings imported. Import holdings under Research > My holdings > History & data to show the book exposure here.'],
      });
    } else {
      const book = summariseBook(holdings, riskLookup);
      const row = book.rows.find((r) => r.iso3 === run.iso3);
      out.push({
        id: 'portfolio',
        heading: SECTION_LABEL.portfolio,
        lines: [
          `Book: $${book.grossUsdMm.toFixed(0)}mm gross, $${book.netCreditUsdMm.toFixed(0)}mm net credit, credit DV01 $${book.dv01UsdK.toFixed(1)}k per bp.`,
          row
            ? `${run.countryName}: $${row.grossUsdMm.toFixed(1)}mm gross (${(row.weight * 100).toFixed(0)}% of the book), $${row.netCreditUsdMm.toFixed(1)}mm net credit, DV01 $${row.dv01UsdK.toFixed(1)}k per bp.`
            : `No current holdings in ${run.countryName}.`,
        ],
      });
    }
  }

  if (include.risks) {
    const lines: string[] = [];
    const rg = sc?.marketTranslationLayer.riskGuardianCheck;
    if (rg) {
      lines.push(`- Estimated maximum drawdown: ${riskPctText(rg.maxDrawdownEstimatePct)}; liquidity haircut: ${riskPctText(rg.liquidityHaircutPct)}.`);
      if (rg.tailRiskHedgeInstrument) lines.push(`- Tail hedge: ${rg.tailRiskHedgeInstrument}.`);
      if (rg.factorCrowdingWarning) lines.push(`- Crowding: ${rg.factorCrowdingWarning}`);
    }
    tickets.forEach((t) => t.preMortemKillSwitchRule && lines.push(`- Kill switch, ${t.strategyTitle}: ${t.preMortemKillSwitchRule}`));
    if (!lines.length) lines.push('No risk notes yet.');
    out.push({ id: 'risks', heading: SECTION_LABEL.risks, lines });
  }

  if (include.calendar) {
    const events = upcomingOfficialEvents([run.iso3], 90);
    out.push({
      id: 'calendar',
      heading: SECTION_LABEL.calendar,
      lines: events.length
        ? events.map((e) => `- ${e.date}: ${e.title}${e.dateKind === 'legal_deadline' ? ' (latest date in law)' : ''} (source: ${e.sourceName})`)
        : [`No official dates on file for ${run.countryName} in the next 90 days.`],
    });
  }

  if (include.sources) {
    out.push({
      id: 'sources',
      heading: SECTION_LABEL.sources,
      lines: [
        `Data status: ${DATA_MODE_LABEL[status.mode]}${status.asOf ? `, as of ${formatAsOf(status.asOf)}` : ''}.`,
        status.liveFeeds.length ? `Live feeds: ${status.liveFeeds.join('; ')}.` : 'No live feeds answered, so the figures above read Missing.',
        'Only live feeds, official series and your own data are used. A missing figure is named, never filled in with a built-in or estimated value.',
        'Model output for discussion. Not investment advice, and not validated for client use.',
      ],
    });
  }
  return out;
}

/** Plain-language note for a private client: no trade levels, scores, DV01 or desk jargon. */
function buildClientSections(p: IcMemoBuilderProps, include: Record<SectionId, boolean>): MemoSection[] {
  const { run, holdings, riskLookup } = p;
  const open = run.openData;
  const sc = modelCouncil(run);
  const status = getSnapshotDataStatus(open);
  const L = CLIENT_SECTION_LABEL as Record<SectionId, string>;
  const out: MemoSection[] = [];
  const clean = (t: string) => t.replace(/\s*\(Ref:[^)]*\)/g, '').trim();
  // Split only where a full stop is followed by a space and a capital, so "14.2" and "+1.5%" stay whole.
  const firstSentences = (t: string, n: number) => t.split(/(?<=[.!?])\s+(?=[A-Z])/).slice(0, n).join(' ').trim();

  if (include.recommendation) {
    out.push({
      id: 'recommendation',
      heading: L.recommendation,
      lines: sc
        ? [`**${run.countryName}.** ${CLIENT_VERDICT[sc.decisionVerdict] || 'We are reviewing our view.'}`]
        : [`We have not yet completed our review of ${run.countryName}. We will follow up once it is done.`],
    });
  }

  if (include.thesis) {
    const lines: string[] = [];
    if (sc?.executiveSummary) lines.push(firstSentences(clean(sc.executiveSummary), 3));
    const vul = sc?.policyResearcherReport.structuralVulnerabilities || [];
    if (vul.length) lines.push('The main things we are weighing:', ...vul.slice(0, 3).map((v) => `- ${firstSentences(clean(v), 1)}`));
    if (!lines.length) lines.push('Write the reasoning here in a few plain sentences.');
    out.push({ id: 'thesis', heading: L.thesis, lines });
  }

  if (include.portfolio) {
    let lines: string[];
    if (!holdings.length) {
      lines = ['Import the client’s holdings under Research > My holdings > History & data to describe their exposure here.'];
    } else {
      const book = summariseBook(holdings, riskLookup);
      const row = book.rows.find((r) => r.iso3 === run.iso3);
      lines = row
        ? [
            `About ${(row.weight * 100).toFixed(0)}% of your emerging market holdings are linked to ${run.countryName} (around $${row.grossUsdMm.toFixed(1)} million).`,
          ]
        : [`You do not currently hold anything linked to ${run.countryName}, so this view does not change your portfolio today.`];
    }
    out.push({ id: 'portfolio', heading: L.portfolio, lines });
  }

  if (include.figures) {
    // Plain language, real figures only: a figure without a source is left out and named.
    const debt = status.live('imf.debtToGdpPct');
    const reserves = status.live('wb.fxReservesMonthsImport');
    const policy = status.live('market.policyRatePct');
    const y10 = status.live('market.sovereign10YBondYieldPct');
    const lines: string[] = [];
    const notYet: string[] = [];
    if (debt !== undefined) lines.push(`- Government debt is ${debt.toFixed(0)}% of the size of the economy.`);
    else notYet.push('government debt');
    if (reserves !== undefined) lines.push(`- Foreign currency savings would cover about ${reserves.toFixed(1)} months of imports.`);
    else notYet.push('foreign currency savings');
    if (policy !== undefined) lines.push(`- The central bank’s interest rate is ${policy.toFixed(2)}%.`);
    else notYet.push('the central bank’s interest rate');
    if (y10 !== undefined && status.officialYield)
      lines.push(
        `- The government pays about ${y10.toFixed(1)}% a year to borrow for 10 years (official figure, ${
          status.officialYield.frequency === 'daily' ? `rate on ${formatPeriod(status.officialYield.period)}` : `${formatPeriod(status.officialYield.period)} average`
        }).`
      );
    else notYet.push('the 10-year borrowing cost');
    if (notYet.length) lines.push(`We do not yet have up-to-date figures for ${notYet.join(', ')}, so they are left out.`);
    out.push({ id: 'figures', heading: L.figures, lines });
  }

  if (include.risks) {
    const rg = sc?.marketTranslationLayer.riskGuardianCheck;
    const lines = rg
      ? [
          typeof rg.maxDrawdownEstimatePct === 'number'
            ? `In a bad scenario, prices of these investments could fall by around ${rg.maxDrawdownEstimatePct}%. They can also be harder to sell quickly in a stressed market.`
            : 'In a bad scenario these investments could lose value and be harder to sell quickly; the app does not estimate by how much yet.',
        ]
      : ['Describe the main risks to the client here in plain terms.'];
    out.push({ id: 'risks', heading: L.risks, lines });
  }

  if (include.calendar) {
    const events = upcomingOfficialEvents([run.iso3], 90);
    out.push({
      id: 'calendar',
      heading: L.calendar,
      lines: events.length
        ? events.slice(0, 5).map((e) => `- ${e.date}: ${e.title}${e.dateKind === 'legal_deadline' ? ' (latest date in law)' : ''}`)
        : [`No scheduled official dates for ${run.countryName} in the next three months.`],
    });
  }

  if (include.sources) {
    out.push({
      id: 'sources',
      heading: L.sources,
      lines: [
        `Figures come from public data sources${status.asOf ? `, as of ${formatAsOf(status.asOf)}` : ''}; any we could not get are left out rather than estimated.`,
        'This note is for discussion with your adviser. It is not a personal recommendation to buy or sell, and the value of investments can go down as well as up.',
      ],
    });
  }
  return out;
}

function toMarkdown(title: string, author: string, sections: Array<{ heading: string; lines: string[] }>): string {
  const date = new Date().toISOString().slice(0, 10);
  return [
    `# ${title}`,
    `${date}${author ? ` · ${author}` : ''}`,
    '',
    ...sections.flatMap((s) => [`## ${s.heading}`, '', ...s.lines.flatMap((l) => (l.startsWith('- ') ? [l] : [l, ''])), '']),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Tiny Markdown-to-HTML for the memo's own subset: #, ##, - bullets, **bold**. Input is escaped first. */
function memoMarkdownToHtml(md: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (t: string) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const html: string[] = [];
  let inList = false;
  for (const line of md.split('\n')) {
    if (line.startsWith('- ')) {
      if (!inList) html.push('<ul>');
      inList = true;
      html.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
    if (line.startsWith('## ')) html.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (line.startsWith('# ')) html.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (line.trim()) html.push(`<p>${inline(line)}</p>`);
  }
  if (inList) html.push('</ul>');
  return html.join('\n');
}

export const IcMemoBuilder: React.FC<IcMemoBuilderProps> = (props) => {
  const { run } = props;
  const [audience, setAudience] = useState<MemoAudience>(props.defaultAudience ?? 'ic');
  // Sections the user switched off, per section id. Anything not listed is included.
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const [ticketScope, setTicketScope] = useState<'country' | 'all'>('country');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [edited, setEdited] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const info = AUDIENCE_INFO[audience];
  const defaultTitle = info.bookLevel ? info.title : `${run.countryName}: ${info.title}`;
  const memoTitle = title.trim() || defaultTitle;
  const labels = sectionLabels(audience);
  const generated = useMemo(
    () => toMarkdown(memoTitle, author.trim(), buildReportSections(props, include, ticketScope, audience)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.run, props.stagedTickets, props.holdings, props.riskLookup, props.peers, include, ticketScope, memoTitle, author, audience]
  );
  const switchAudience = (a: MemoAudience) => {
    setAudience(a);
    setEdited(null);
  };
  const memo = edited ?? generated;
  const html = useMemo(() => memoMarkdownToHtml(memo), [memo]);

  const download = () => {
    const blob = new Blob([withNotice(memo)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${info.bookLevel ? 'book' : run.iso3}-${info.file}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(withNotice(memo));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  const print = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${memoTitle.replace(/</g, '&lt;')}</title>
<style>body{font-family:'Public Sans',-apple-system,Segoe UI,sans-serif;max-width:720px;margin:40px auto;color:#0f172a;line-height:1.5;font-size:14px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
p{margin:6px 0}ul{margin:6px 0;padding-left:20px}li{margin:3px 0}</style></head><body>${memoMarkdownToHtml(withNotice(memo))}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3" data-no-stat-ref="true" data-no-provenance-overlay="true">
      <section className="ui-panel" aria-label="Memo settings">
        <header className="ui-panel-header">
          <h2 className="ui-section-title">Build the report</h2>
          <p className="ui-label">
            {audience === 'council'
              ? 'Pulls the last council brief you sent from Workspace.'
              : info.bookLevel
              ? 'Pulls your holdings (or the watchlist at equal weight), staged tickets and the official calendar.'
              : 'Pulls the current country, your tickets, holdings and the official calendar.'}
          </p>
        </header>
        <div className="p-4 space-y-4">
          <div role="tablist" aria-label="Memo type" className="flex flex-wrap gap-1.5">
            {(props.audiences?.length ? props.audiences : (Object.keys(AUDIENCE_INFO) as MemoAudience[])).map((a) => (
              <button key={a} type="button" role="tab" aria-selected={audience === a} className="ui-pill" onClick={() => switchAudience(a)}>
                {AUDIENCE_INFO[a].tab}
              </button>
            ))}
          </div>
          <p className="ui-label">{info.help}</p>
          <label className="block ui-label space-y-0.5">
            <span className="block">Title</span>
            <input
              className="w-full px-2 py-1 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              placeholder={defaultTitle}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="block ui-label space-y-0.5">
            <span className="block">Author (optional)</span>
            <input
              className="w-full px-2 py-1 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </label>
          <fieldset className="space-y-1.5">
            <legend className="ui-label mb-1">Sections</legend>
            {Object.keys(labels).map((id) => (
              <label key={id} className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
                <input type="checkbox" checked={include[id] !== false} onChange={(e) => setInclude({ ...include, [id]: e.target.checked })} />
                {labels[id]}
              </label>
            ))}
          </fieldset>
          {audience === 'ic' && (
          <fieldset className="space-y-1.5">
            <legend className="ui-label mb-1">Trade tickets</legend>
            <label className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
              <input type="radio" name="memo-scope" checked={ticketScope === 'country'} onChange={() => setTicketScope('country')} />
              {run.countryName} only
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
              <input type="radio" name="memo-scope" checked={ticketScope === 'all'} onChange={() => setTicketScope('all')} />
              All staged tickets
            </label>
          </fieldset>
          )}
          <p className="ui-label">To write a memo on another country, switch country under Research › One country, then come back.</p>
        </div>
      </section>

      <section className="ui-panel xl:col-span-2" aria-label="Memo">
        <header className="ui-panel-header flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="ui-section-title">{info.heading}</h2>
            <p className="ui-label">{edited !== null ? 'Edited by you. Settings changes are paused until you reset.' : 'Edit the text below before you share it.'}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {edited !== null && (
              <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setEdited(null)}>
                Reset to generated
              </button>
            )}
            <button type="button" className="ui-btn" onClick={copy}>
              <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="ui-btn" onClick={download}>
              <Download className="w-3.5 h-3.5" /> Markdown
            </button>
            <button type="button" className="ui-btn ui-btn-primary" onClick={print}>
              <Printer className="w-3.5 h-3.5" /> Print or save PDF
            </button>
          </div>
        </header>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:divide-x divide-slate-100 dark:divide-slate-800">
          <div className="p-4">
            <label htmlFor="memo-text" className="ui-label block mb-1">
              Text
            </label>
            <textarea
              id="memo-text"
              value={memo}
              onChange={(e) => setEdited(e.target.value)}
              rows={28}
              className="w-full px-2 py-1.5 text-xs font-code border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="p-4">
            <div className="ui-label mb-1">Preview</div>
            <article
              className="ic-memo-preview text-sm text-slate-800 dark:text-slate-200 space-y-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-slate-900 dark:[&_h1]:text-white [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:pb-1 [&_h2]:border-b [&_h2]:border-slate-200 dark:[&_h2]:border-slate-700 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        </div>
      </section>
    </div>
  );
};
