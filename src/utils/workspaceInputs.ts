/**
 * Workspace > Your inputs: everything the user sets that changes what Workspace shows, one chip each,
 * with its state and the panels it feeds. Replaces the four-step Getting started card: a step that is
 * not done shows here as "Needs setup" with the fix, and stays visible once done so the link from
 * input to output never disappears.
 */

export type InputId = 'watchlist' | 'country' | 'holdings' | 'feeds' | 'keys' | 'ai' | 'research';
export type PanelId = 'digest' | 'watchlist' | 'calendar' | 'council' | 'alerts';

export const PANEL_LABEL: Record<PanelId, string> = {
  digest: 'What moved',
  watchlist: 'Watchlist',
  calendar: 'Next two weeks',
  council: 'Council chat',
  alerts: 'Watch alerts',
};

/** ok = set and working; setup = the user has to do something; empty = optional and not used yet. */
export type InputState = 'ok' | 'setup' | 'empty';

export interface InputChip {
  id: InputId;
  label: string;
  value: string;
  state: InputState;
  /** One line on what the state means, e.g. why it needs setup. */
  note: string;
  /** Workspace panels this input changes. */
  drives: PanelId[];
  /** Other pages it feeds, in words. */
  alsoFeeds?: string;
  action: string;
}

export interface WorkspaceInputsState {
  watchlistName: string;
  watchlistCount: number;
  /** The country open in Country Research (the full council runs on it). */
  countryName: string;
  holdingsCount: number;
  /** Watchlist countries with at least one feed that answered on the last pull. */
  liveCount: number;
  /** Where each key comes from, from /api/settings/keys. Undefined while loading or unreadable. */
  keys?: { id: string; label?: string; source: 'app' | 'env' | 'none'; section?: string }[];
  /** Menu > Settings > AI model choice. */
  aiProvider?: string;
  /** Saved council briefs and policy documents (data/local/research.json). Undefined while loading. */
  research?: { briefs: number; docs: number };
}

const AI_LABEL: Record<string, string> = {
  ollama: 'Ollama on this computer',
  hybrid: 'Gemini and Ollama',
  openai_compatible: 'Your own model server',
  gemini: 'Gemini',
};

export function hasAiModel(aiProvider: string | undefined, keys: WorkspaceInputsState['keys']): boolean {
  if (aiProvider === 'ollama' || aiProvider === 'hybrid' || aiProvider === 'openai_compatible') return true;
  return Boolean(keys?.some((k) => k.id === 'GEMINI_API_KEY' && k.source !== 'none'));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function workspaceInputs(s: WorkspaceInputsState): InputChip[] {
  const freeKeys = (s.keys || []).filter((k) => (k.section || 'free_key') === 'free_key' && k.id !== 'GEMINI_API_KEY');
  const keysSet = freeKeys.filter((k) => k.source !== 'none').length;
  const fred = s.keys?.find((k) => k.id === 'FRED_API_KEY');
  const fredSet = Boolean(fred && fred.source !== 'none');
  const ai = hasAiModel(s.aiProvider, s.keys);
  const research = s.research;
  const researchCount = research ? research.briefs + research.docs : 0;

  return [
    {
      id: 'watchlist',
      label: 'Watchlist',
      value: s.watchlistCount ? plural(s.watchlistCount, 'country', 'countries') : 'No countries',
      state: s.watchlistCount ? 'ok' : 'setup',
      note: s.watchlistCount ? `${s.watchlistName}: every panel here works from these countries.` : 'Missing: add the countries you follow.',
      drives: ['digest', 'watchlist', 'calendar', 'council', 'alerts'],
      alsoFeeds: 'Compare',
      action: 'Edit watchlist',
    },
    {
      id: 'country',
      label: 'Open country',
      value: s.countryName || 'None',
      state: s.countryName ? 'ok' : 'empty',
      note: 'Marked Open in the watchlist; the full council runs on it. Pick another from the watchlist.',
      drives: ['watchlist', 'council'],
      alsoFeeds: 'Research > One country',
      action: 'Open Research > One country',
    },
    {
      id: 'feeds',
      label: 'Data feeds',
      value: s.watchlistCount ? `Live for ${s.liveCount} of ${s.watchlistCount}` : 'No countries',
      state: s.liveCount > 0 ? 'ok' : 'setup',
      note:
        s.liveCount > 0
          ? 'Countries where at least one public feed answered on the last pull.'
          : 'Missing: no feed has answered yet.',
      drives: ['digest', 'watchlist', 'council', 'alerts'],
      action: 'Open Data connections',
    },
    {
      id: 'keys',
      label: 'Free keys',
      value: s.keys ? `${keysSet} of ${freeKeys.length} set` : 'Missing',
      state: !s.keys ? 'setup' : fredSet ? 'ok' : 'setup',
      note: !s.keys
        ? 'Missing: the app server did not answer.'
        : fredSet
          ? 'FRED is set: official 10Y yields for the US, Mexico, South Africa and others.'
          : 'Add a free FRED key for official 10Y yields.',
      drives: ['digest', 'watchlist', 'council'],
      action: 'Open Settings',
    },
    {
      id: 'ai',
      label: 'AI model',
      value: ai ? AI_LABEL[s.aiProvider || ''] || 'Chosen' : 'Not chosen',
      state: ai ? 'ok' : 'setup',
      note: ai
        ? 'Writes the council summary, the debate and agent picks.'
        : 'No summary or full council without one.',
      drives: ['council'],
      action: 'Choose AI model',
    },
    {
      id: 'holdings',
      label: 'Holdings',
      value: s.holdingsCount ? plural(s.holdingsCount, 'position') : 'None yet',
      state: s.holdingsCount ? 'ok' : 'empty',
      note: s.holdingsCount ? 'Countries you hold are marked Held in the watchlist.' : 'Optional: import a CSV of your positions.',
      drives: ['watchlist'],
      alsoFeeds: 'Portfolio',
      action: 'Open holdings',
    },
    {
      id: 'research',
      label: 'Saved research',
      value: !research ? 'Missing' : researchCount ? `${plural(research.briefs, 'brief')} · ${plural(research.docs, 'document')}` : 'None yet',
      state: !research ? 'setup' : researchCount ? 'ok' : 'empty',
      note: !research
        ? 'Missing: the app server did not answer.'
        : researchCount
          ? 'Kept on this computer (data/local/research.json).'
          : 'Briefs you save and policy documents you add appear under Council chat.',
      drives: ['council'],
      alsoFeeds: 'Reports',
      action: 'Show in Council chat',
    },
  ];
}

/** The inputs each panel uses, for the "Uses:" line on the panel. */
export function panelUses(chips: InputChip[], panel: PanelId): InputChip[] {
  return chips.filter((c) => c.drives.includes(panel));
}
