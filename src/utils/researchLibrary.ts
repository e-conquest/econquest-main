/**
 * Research library (Sam, 2026-11-05): council conversations and policy documents kept on this
 * computer, so they survive a reload and can be reopened, copied or sent to Reports later.
 *
 * Saved in data/local/research.json (DATA_DIR/local when DATA_DIR is set). data/local/ is in
 * .gitignore and is shared by `npm run dev` and Docker (docker-compose bind-mounts it), like the
 * Settings file. Nothing here is sent anywhere.
 *
 * The pure functions (add, remove, list) are browser-safe; only loadLibrary and saveLibrary touch
 * the file system, and the server imports them.
 */
import type { SavedCouncilBrief } from './askCouncil';
import type { PolicyDoc } from './policyDocs';
import { isCouncilDocument, type CouncilDocument } from './agentDocument';
import { MAX_DOC_CHARS } from './policyDocs';

export const MAX_SAVED_BRIEFS = 200;
export const MAX_SAVED_DOCS = 30;
/** Standard council documents saved to Reports (agent and synthesis documents). */
export const MAX_COUNCIL_DOCS = 300;
export const MAX_NOTEBOOKS = 50;
export const MAX_NOTEBOOK_NOTES = 20000;

/** A research notebook: saved conversations and documents grouped under one topic, with your notes. */
export interface Notebook {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  briefIds: string[];
  docIds: string[];
  notes: string;
}

export const MAX_EPISODES = 50;
export const MAX_EPISODE_QUESTIONS = 12;

/**
 * A teaching episode: a country and a past decision date, the questions students should answer
 * from the data, and your notes. It holds no figures: the handout reads them from the app's own
 * series for that date (decision replay, archived pull).
 */
export interface Episode {
  id: string;
  title: string;
  iso3: string;
  /** YYYY-MM-DD (or YYYY-MM) of the decision or moment the episode is about. */
  date: string;
  questions: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotebookSummary {
  id: string;
  title: string;
  updatedAt: string;
  briefIds: string[];
  docIds: string[];
  notesChars: number;
}

export interface SavedBriefEntry extends SavedCouncilBrief {
  id: string;
  savedAt: string;
}

export type SavedCouncilDoc = CouncilDocument & { savedAt: string };

export interface ResearchLibrary {
  briefs: SavedBriefEntry[];
  docs: PolicyDoc[];
  notebooks: Notebook[];
  episodes: Episode[];
  /** Agent and synthesis documents from Council chat, saved to Reports. */
  councilDocs: SavedCouncilDoc[];
}

/** One line per saved council document, for the Reports list. */
export interface CouncilDocSummary {
  id: string;
  kind: CouncilDocument['kind'];
  /** "Central Bank Watcher Agent" or "Synthesis". */
  author: string;
  question: string;
  askedAt: string;
  savedAt: string;
  scope: string;
  /** Agent: coverage level; synthesis: written or not. */
  status: string;
}

/** One line per saved conversation, for the list. */
export interface BriefSummary {
  id: string;
  question: string;
  askedAt: string;
  savedAt: string;
  scopeNote: string;
  headline?: string;
  /** Questions in the conversation, counting this one. */
  turns: number;
  /** Countries the agents answered on (ISO3) and the agents asked, for "what changed since last time". */
  countries: string[];
  agents: string[];
}

export interface DocSummary {
  id: string;
  title: string;
  addedAt: string;
  pages?: number;
  chars: number;
}

export const EMPTY_LIBRARY: ResearchLibrary = { briefs: [], docs: [], notebooks: [], episodes: [], councilDocs: [] };

/** A conversation's id: the time its latest question was asked, so later answers overwrite it. */
export const briefId = (askedAt: string) => `b-${askedAt.replace(/[^0-9]/g, '')}`;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export function isBrief(v: unknown): v is SavedCouncilBrief {
  const b = v as SavedCouncilBrief;
  return Boolean(b && typeof b.question === 'string' && b.question.trim() && typeof b.askedAt === 'string' && Array.isArray(b.answers));
}

export function isDoc(v: unknown): v is PolicyDoc {
  const d = v as PolicyDoc;
  return Boolean(d && typeof d.id === 'string' && d.id && typeof d.title === 'string' && typeof d.text === 'string' && d.text.trim());
}

/** Add or replace a conversation (same id = same conversation, newer answer), newest first. */
export function addBrief(lib: ResearchLibrary, b: SavedCouncilBrief, now: Date = new Date()): { lib: ResearchLibrary; id: string } {
  const id = briefId(b.startedAt || b.askedAt);
  const entry: SavedBriefEntry = { ...b, question: str(b.question, 500), id, savedAt: now.toISOString() };
  const briefs = [entry, ...lib.briefs.filter((x) => x.id !== id)].sort((x, y) => y.askedAt.localeCompare(x.askedAt)).slice(0, MAX_SAVED_BRIEFS);
  return { lib: { ...lib, briefs }, id };
}

/** Deleting a conversation also takes it out of every notebook. */
export function removeBrief(lib: ResearchLibrary, id: string): ResearchLibrary {
  return { ...lib, briefs: lib.briefs.filter((b) => b.id !== id), notebooks: lib.notebooks.map((n) => (n.briefIds.includes(id) ? { ...n, briefIds: n.briefIds.filter((x) => x !== id) } : n)) };
}

/** Add a document (same id replaces), newest first, text capped as in the picker. */
export function addDoc(lib: ResearchLibrary, d: PolicyDoc): ResearchLibrary {
  const doc: PolicyDoc = { id: str(d.id, 80), title: str(d.title, 200) || 'Document', text: d.text.slice(0, MAX_DOC_CHARS), addedAt: str(d.addedAt, 40) || new Date().toISOString(), ...(d.pages ? { pages: d.pages } : {}) };
  return { ...lib, docs: [doc, ...lib.docs.filter((x) => x.id !== doc.id)].slice(0, MAX_SAVED_DOCS) };
}

/** Save a council document to Reports (same id replaces: the same agent on the same question), newest first. */
export function addCouncilDoc(lib: ResearchLibrary, d: CouncilDocument, now: Date = new Date()): ResearchLibrary {
  const entry: SavedCouncilDoc = { ...d, question: str(d.question, 500), savedAt: now.toISOString() };
  const councilDocs = [entry, ...lib.councilDocs.filter((x) => x.id !== d.id)].sort((x, y) => y.askedAt.localeCompare(x.askedAt)).slice(0, MAX_COUNCIL_DOCS);
  return { ...lib, councilDocs };
}

export function removeCouncilDoc(lib: ResearchLibrary, id: string): ResearchLibrary {
  return { ...lib, councilDocs: lib.councilDocs.filter((d) => d.id !== id) };
}

/** Deleting a document also takes it out of every notebook. */
export function removeDoc(lib: ResearchLibrary, id: string): ResearchLibrary {
  return { ...lib, docs: lib.docs.filter((d) => d.id !== id), notebooks: lib.notebooks.map((n) => (n.docIds.includes(id) ? { ...n, docIds: n.docIds.filter((x) => x !== id) } : n)) };
}

const ids = (v: unknown, max: number): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80))].slice(0, max) : []);

/** A new notebook, newest first. A blank title is refused (null). */
export function addNotebook(lib: ResearchLibrary, title: string, now: Date = new Date()): { lib: ResearchLibrary; id: string } | null {
  const t = str(title, 120).trim();
  if (!t) return null;
  if (lib.notebooks.length >= MAX_NOTEBOOKS) return null;
  const at = now.toISOString();
  let id = `n-${at.replace(/[^0-9]/g, '')}`;
  while (lib.notebooks.some((n) => n.id === id)) id += 'x';
  const nb: Notebook = { id, title: t, createdAt: at, updatedAt: at, briefIds: [], docIds: [], notes: '' };
  return { lib: { ...lib, notebooks: [nb, ...lib.notebooks] }, id };
}

export type NotebookPatch = Partial<Pick<Notebook, 'title' | 'notes' | 'briefIds' | 'docIds'>>;

/** Change a notebook's title, notes or contents. Only conversations and documents that exist are kept. */
export function updateNotebook(lib: ResearchLibrary, id: string, patch: NotebookPatch, now: Date = new Date()): ResearchLibrary | null {
  const nb = lib.notebooks.find((n) => n.id === id);
  if (!nb) return null;
  const title = patch.title !== undefined ? str(patch.title, 120).trim() || nb.title : nb.title;
  const briefSet = new Set(lib.briefs.map((b) => b.id));
  const docSet = new Set(lib.docs.map((d) => d.id));
  const next: Notebook = {
    ...nb,
    title,
    notes: patch.notes !== undefined ? str(patch.notes, MAX_NOTEBOOK_NOTES) : nb.notes,
    briefIds: patch.briefIds !== undefined ? ids(patch.briefIds, MAX_SAVED_BRIEFS).filter((x) => briefSet.has(x)) : nb.briefIds,
    docIds: patch.docIds !== undefined ? ids(patch.docIds, MAX_SAVED_DOCS).filter((x) => docSet.has(x)) : nb.docIds,
    updatedAt: now.toISOString(),
  };
  return { ...lib, notebooks: [next, ...lib.notebooks.filter((n) => n.id !== id)] };
}

export function removeNotebook(lib: ResearchLibrary, id: string): ResearchLibrary {
  return { ...lib, notebooks: lib.notebooks.filter((n) => n.id !== id) };
}

const DATE_RE = /^\d{4}-\d{2}(-\d{2})?$/;
const ISO3_RE = /^[A-Z]{3}$/;

function cleanQuestions(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\r?\n/) : [];
  return list
    .filter((q): q is string => typeof q === 'string')
    .map((q) => q.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, MAX_EPISODE_QUESTIONS);
}

export type EpisodeInput = { title?: unknown; iso3?: unknown; date?: unknown; questions?: unknown; notes?: unknown };

/** A new episode; null with the reason when a field is missing or wrong. */
export function addEpisode(lib: ResearchLibrary, input: EpisodeInput, now: Date = new Date()): { lib: ResearchLibrary; id: string } | { error: string } {
  const title = str(input.title, 120).trim();
  const iso3 = str(input.iso3, 10).trim().toUpperCase();
  const date = str(input.date, 10);
  if (!title) return { error: 'An episode needs a title.' };
  if (!ISO3_RE.test(iso3)) return { error: 'An episode needs a country (ISO3 code).' };
  if (!DATE_RE.test(date)) return { error: 'An episode needs a date, YYYY-MM-DD.' };
  if (lib.episodes.length >= MAX_EPISODES) return { error: `At most ${MAX_EPISODES} episodes; delete one first.` };
  const at = now.toISOString();
  let id = `e-${at.replace(/[^0-9]/g, '')}`;
  while (lib.episodes.some((e) => e.id === id)) id += 'x';
  const ep: Episode = { id, title, iso3, date, questions: cleanQuestions(input.questions), notes: str(input.notes, MAX_NOTEBOOK_NOTES), createdAt: at, updatedAt: at };
  return { lib: { ...lib, episodes: [ep, ...lib.episodes] }, id };
}

/** Change an episode; fields that are blank or wrong keep their old value. */
export function updateEpisode(lib: ResearchLibrary, id: string, input: EpisodeInput, now: Date = new Date()): ResearchLibrary | null {
  const ep = lib.episodes.find((e) => e.id === id);
  if (!ep) return null;
  const title = input.title !== undefined ? str(input.title, 120).trim() : '';
  const iso3 = input.iso3 !== undefined ? str(input.iso3, 10).trim().toUpperCase() : '';
  const date = input.date !== undefined ? str(input.date, 10) : '';
  const next: Episode = {
    ...ep,
    title: title || ep.title,
    iso3: ISO3_RE.test(iso3) ? iso3 : ep.iso3,
    date: DATE_RE.test(date) ? date : ep.date,
    questions: input.questions !== undefined ? cleanQuestions(input.questions) : ep.questions,
    notes: input.notes !== undefined ? str(input.notes, MAX_NOTEBOOK_NOTES) : ep.notes,
    updatedAt: now.toISOString(),
  };
  return { ...lib, episodes: [next, ...lib.episodes.filter((e) => e.id !== id)] };
}

export function removeEpisode(lib: ResearchLibrary, id: string): ResearchLibrary {
  return { ...lib, episodes: lib.episodes.filter((e) => e.id !== id) };
}

/** Topics to start a notebook from: countries with two or more saved conversations, most first. */
export function suggestedTopics(briefs: BriefSummary[], notebooks: Pick<Notebook, 'title'>[], names: Record<string, string> = {}): Array<{ iso3: string; title: string; briefIds: string[] }> {
  const by = new Map<string, string[]>();
  for (const b of briefs) for (const c of b.countries) by.set(c, [...(by.get(c) || []), b.id]);
  const taken = new Set(notebooks.map((n) => n.title.toLowerCase()));
  return [...by.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([iso3, list]) => ({ iso3, title: names[iso3] || iso3, briefIds: list }))
    .filter((t) => !taken.has(t.title.toLowerCase()))
    .sort((a, b) => b.briefIds.length - a.briefIds.length || a.title.localeCompare(b.title));
}

export function summarise(lib: ResearchLibrary): { briefs: BriefSummary[]; docs: DocSummary[]; notebooks: NotebookSummary[]; episodes: Episode[]; councilDocs: CouncilDocSummary[] } {
  return {
    briefs: lib.briefs.map((b) => ({
      id: b.id,
      question: b.question,
      askedAt: b.askedAt,
      savedAt: b.savedAt,
      scopeNote: b.scopeNote,
      ...(b.synthesis?.brief?.headline ? { headline: b.synthesis.brief.headline } : {}),
      turns: (b.earlier?.length || 0) + 1,
      countries: [...new Set(b.answers.flatMap((a) => (a.findings || []).filter((f) => !String(f.iso3).startsWith('doc:')).map((f) => f.iso3)))],
      agents: [...new Set(b.answers.map((a) => a.id))],
    })),
    docs: lib.docs.map((d) => ({ id: d.id, title: d.title, addedAt: d.addedAt, ...(d.pages ? { pages: d.pages } : {}), chars: d.text.length })),
    notebooks: lib.notebooks.map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt, briefIds: n.briefIds, docIds: n.docIds, notesChars: n.notes.length })),
    episodes: lib.episodes,
    councilDocs: lib.councilDocs.map((d) => ({
      id: d.id,
      kind: d.kind,
      author: d.kind === 'agent' ? `${d.agentName} Agent` : 'Synthesis',
      question: d.question,
      askedAt: d.askedAt,
      savedAt: d.savedAt,
      scope: d.scope,
      status: d.kind === 'agent' ? `coverage ${d.coverage?.level || 'none'}` : d.status,
    })),
  };
}

/** Anything unreadable in the file is dropped; a missing or broken file reads as empty. */
export function parseLibrary(raw: unknown): ResearchLibrary {
  const r = raw as Partial<ResearchLibrary> | null;
  return {
    briefs: Array.isArray(r?.briefs) ? r!.briefs.filter((b): b is SavedBriefEntry => isBrief(b) && typeof (b as SavedBriefEntry).id === 'string') : [],
    docs: Array.isArray(r?.docs) ? r!.docs.filter(isDoc) : [],
    notebooks: Array.isArray(r?.notebooks) ? r!.notebooks.flatMap((n) => parseNotebook(n)) : [],
    episodes: Array.isArray(r?.episodes) ? r!.episodes.flatMap((e) => parseEpisode(e)) : [],
    councilDocs: Array.isArray(r?.councilDocs) ? r!.councilDocs.filter((d): d is SavedCouncilDoc => isCouncilDocument(d) && typeof (d as SavedCouncilDoc).savedAt === 'string') : [],
  };
}

function parseNotebook(v: unknown): Notebook[] {
  const n = v as Partial<Notebook> | null;
  if (!n || typeof n.id !== 'string' || !n.id || typeof n.title !== 'string' || !n.title.trim()) return [];
  return [
    {
      id: n.id.slice(0, 80),
      title: n.title.slice(0, 120),
      createdAt: str(n.createdAt, 40),
      updatedAt: str(n.updatedAt, 40),
      briefIds: ids(n.briefIds, MAX_SAVED_BRIEFS),
      docIds: ids(n.docIds, MAX_SAVED_DOCS),
      notes: str(n.notes, MAX_NOTEBOOK_NOTES),
    },
  ];
}

function parseEpisode(v: unknown): Episode[] {
  const e = v as Partial<Episode> | null;
  if (!e || typeof e.id !== 'string' || !e.id || typeof e.title !== 'string' || !e.title.trim()) return [];
  if (typeof e.iso3 !== 'string' || !ISO3_RE.test(e.iso3) || typeof e.date !== 'string' || !DATE_RE.test(e.date)) return [];
  return [
    {
      id: e.id.slice(0, 80),
      title: e.title.slice(0, 120),
      iso3: e.iso3,
      date: e.date,
      questions: cleanQuestions(e.questions),
      notes: str(e.notes, MAX_NOTEBOOK_NOTES),
      createdAt: str(e.createdAt, 40),
      updatedAt: str(e.updatedAt, 40),
    },
  ];
}
