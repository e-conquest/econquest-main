/**
 * The agent networks shown while the council works: which agents run, in what order, and each
 * one's live status. Statuses come from the server (/api/council/progress/:id) for the full
 * council, and from the browser for Council chat, whose desk agents run instantly on the
 * app's own figures.
 */
import type { AgentColumn, AgentNode, AgentStatus, ProgressSteps } from '../components/AgentNetwork';
import type { AgentAnswer, SynthesisResult } from './askCouncil';

const DESKS: Array<{ id: string; label: string; members: string[] }> = [
  { id: 'geo', label: 'Geopolitical desk', members: ['Intelligence Scraper', 'Transmission Mapping', 'Sanctions & Legal'] },
  { id: 'sov', label: 'Sovereign credit desk', members: ['Fiscal Auditor', 'External Balance Sheet', 'Political Will & Governance'] },
  { id: 'macro', label: 'Macro desk', members: ['High-Frequency Nowcaster', 'Central Bank Watcher', 'Global Spillover'] },
];

export type FullCouncilPhase = 'idle' | 'debating' | 'awaiting_review' | 'writing_report' | 'done';

/** The full nine-agent council: data, three desk debates and web search, cascade, you, final report. */
export function fullCouncilColumns(steps: ProgressSteps, phase: FullCouncilPhase): AgentColumn[] {
  const node = (id: string, label: string, task: string, extra: Partial<AgentNode> = {}): AgentNode => {
    const s = steps[id];
    return { id, label, task, status: s?.status ?? 'waiting', ...(s?.ms !== undefined ? { ms: s.ms } : {}), ...(s?.note ? { note: s.note } : {}), ...extra };
  };
  const review: AgentNode = {
    id: 'review',
    label: 'You',
    task: 'Approve or change the assumptions',
    status: phase === 'awaiting_review' ? 'running' : phase === 'writing_report' || phase === 'done' ? 'done' : 'waiting',
    ...(phase === 'awaiting_review' ? { note: 'waiting for your approval' } : {}),
  };
  return [
    { title: '1. Data', nodes: [node('data', 'Data refresh', 'IMF, World Bank, market and news figures')] },
    {
      title: '2. Desk debates, in parallel',
      nodes: [
        ...DESKS.map((d) =>
          node(d.id, d.label, 'Three analysts argue it out, with a devil’s advocate', {
            members: d.members,
            help: 'One model call covers the desk’s three analysts and its debate, so they finish together.',
          })
        ),
        node('search', 'Web search', 'Recent news, with source links'),
      ],
    },
    { title: '3. Knock-on effects', nodes: [node('cascade', 'Cascade', 'Feeds each desk’s shocks into the others')] },
    { title: '4. Your review', nodes: [review] },
    { title: '5. Final report', nodes: [node('supreme', 'Supreme council', 'Weighs everything and writes the verdict')] },
  ];
}

/** Council chat: the planner, the desk agents it chose, then the synthesis agent. */
export function askCouncilColumns(answers: AgentAnswer[], writing: boolean, synthesis: SynthesisResult | null, chosenBy: 'ai' | 'words' = 'words'): AgentColumn[] {
  const synth: { status: AgentStatus; note?: string } = writing
    ? { status: 'running' }
    : synthesis?.brief
      ? { status: 'done', note: synthesis.removed.length ? `${synthesis.removed.length} sentence(s) removed by the number check` : undefined }
      : synthesis
        ? { status: 'skipped', note: synthesis.reason ? `no summary: ${synthesis.reason}` : 'no summary' }
        : { status: 'waiting' };
  return [
    {
      title: '1. Planner',
      nodes: [
        chosenBy === 'ai'
          ? { id: 'planner', label: 'Planner', task: 'The AI model picked the agents for your question', status: 'done', note: 'AI pick, checked against the agent list' }
          : { id: 'planner', label: 'Planner', task: 'Picks agents from words in your question', status: 'done', note: 'stated rules, not AI' },
      ],
    },
    {
      title: '2. Desk agents, on the app’s figures',
      nodes: answers.map((a) => ({
        id: a.id,
        label: `${a.name} Agent`,
        task: a.why.replace(/^the question mentions/, 'Asked: you mentioned').replace(/^the AI model judged:/, 'AI pick:').replace(/^you added/, 'Asked: you added'),
        status: 'done' as const,
        note: a.findings.length
          ? `${a.findings.length} ${a.id === 'doc' ? (a.findings.length === 1 ? 'passage' : 'passages') : a.findings.length === 1 ? 'country' : 'countries'}`
          : 'nothing to report',
      })),
    },
    { title: '3. Synthesis', nodes: [{ id: 'synthesis', label: 'Synthesis agent', task: 'Writes the brief from the agents’ figures only', ...synth }] },
  ];
}
