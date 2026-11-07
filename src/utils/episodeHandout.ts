/**
 * A teaching episode as a Markdown handout: the question set, and the data as it stood the week
 * before the date, read from the app's own series (decision replay), each figure with its source
 * and the replay's caveats. The teacher's copy adds your notes. Browser-safe.
 */
import type { DecisionReplay } from './decisionReplay';
import { replaySentence } from './decisionReplay';
import type { Episode } from './researchLibrary';
import { withNotice } from './disclaimer';

const p2 = (v: number) => `${v.toFixed(2)}%`;

export function episodeMarkdown(
  ep: Episode,
  countryName: string,
  replay: { replay: DecisionReplay; policySource: string | null } | { error: string },
  opts: { teacher?: boolean; now?: Date } = {}
): string {
  const now = opts.now ?? new Date();
  const lines: string[] = [`# ${ep.title}`, '', `${countryName}, ${ep.date}. Handout made ${now.toISOString().slice(0, 10)}${opts.teacher ? ' (teacher copy)' : ''}.`, ''];
  lines.push('## The data the week before', '');
  if ('error' in replay) {
    lines.push(`Missing: ${replay.error}`, '');
  } else {
    const r = replay.replay;
    lines.push(
      `- Policy rate on ${r.asOf}: ${p2(r.rateBeforePct)}${replay.policySource ? ` (${replay.policySource})` : ''}`,
      `- Inflation, latest month before the decision: ${r.inflation ? `${p2(r.inflation.pct)} for ${r.inflation.month} (${r.inflation.source})` : 'Missing'}`,
      `- Inflation target: ${r.target ? `${r.target.pct}%${r.target.bandPts ? ` ± ${r.target.bandPts}` : ''} (${r.target.bank}, ${r.target.url})` : 'Missing'}`,
      `- OECD leading indicator: ${r.cli ? `${r.cli.level.toFixed(2)} for ${r.cli.month}${r.cli.change6m !== undefined ? `, ${r.cli.change6m > 0 ? '+' : ''}${r.cli.change6m.toFixed(2)} over 6 months` : ''} (OECD via DBnomics)` : 'Missing'}`,
      ''
    );
    if (opts.teacher) {
      lines.push('## What happened (teacher copy)', '', replaySentence(r), '');
      if (r.rule) lines.push(`Method: ${r.rule.method}. Within 1 pt of the rule counts as a hold.`, '');
    }
    lines.push('Caveats:', ...r.caveats.map((c) => `- ${c}`), '');
  }
  lines.push('## Questions', '');
  if (ep.questions.length) ep.questions.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
  else lines.push('_No questions set for this episode yet._');
  lines.push('', 'Answer from the figures above and from Council chat in the app; name the source of every figure you use.', '');
  if (opts.teacher && ep.notes.trim()) lines.push('## Notes (teacher copy)', '', ep.notes.trim(), '');
  return withNotice(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n');
}

export function episodeFileName(ep: Episode, teacher = false): string {
  const slug =
    ep.title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'episode';
  return `episode-${slug}${teacher ? '-teacher' : ''}.md`;
}
