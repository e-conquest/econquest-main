/**
 * Morning brief (Menu > Settings > Morning brief): at a time you set, the app asks the council your
 * standing questions about a watchlist, writes the summary with your AI model, and saves each one to
 * saved research (Reports) with what moved since the last time the same question was asked.
 *
 * Settings live in data/local/morning-brief.json. The time is read in the time zone of the browser
 * that saved it, so it is right under Docker (whose clock runs on UTC) as well as `npm run dev`.
 * The app must be running at that time; a brief missed while it was closed runs when it next starts
 * that day, never for a day already past.
 */

export const MAX_QUESTIONS = 4;
export const MAX_QUESTION_CHARS = 300;

/** Starting questions: policy stance, cheap or rich, and what is coming up. Change them freely. */
export const DEFAULT_QUESTIONS = [
  'How does inflation compare with the policy rate across my watchlist?',
  'Which countries look cheap or rich against their peers?',
  'What dates and catalysts are coming up in the next two weeks?',
];

export interface MorningBriefSettings {
  enabled: boolean;
  /** Local time, HH:MM (24-hour). */
  time: string;
  /** IANA time zone the time is read in, e.g. "Europe/London". */
  timeZone: string;
  questions: string[];
  /** Watchlist to ask about (id); the first watchlist when not set or not found. */
  watchlistId?: string;
}

export interface MorningBriefRun {
  /** When it ran (ISO) and the local day it counts for (YYYY-MM-DD in the settings' zone). */
  at: string;
  day: string;
  trigger: 'schedule' | 'manual';
  watchlist: string;
  countries: number;
  /** One line per question: the saved brief's id and headline, or why there is none. */
  results: Array<{ question: string; briefId?: string; headline?: string; note?: string }>;
}

export interface MorningBriefFile {
  settings: MorningBriefSettings;
  lastRun?: MorningBriefRun;
  /** Local day of the last scheduled run (a manual run does not count as the day's brief). */
  lastScheduledDay?: string;
}

export const DEFAULT_SETTINGS: MorningBriefSettings = { enabled: false, time: '07:00', timeZone: 'UTC', questions: DEFAULT_QUESTIONS };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A problem with new settings, or null when they can be saved. */
export function settingsProblem(s: unknown): string | null {
  const o = s as Partial<MorningBriefSettings> | null;
  if (!o || typeof o !== 'object') return 'Settings are needed.';
  if (typeof o.enabled !== 'boolean') return 'Say whether the brief is on.';
  if (typeof o.time !== 'string' || !TIME_RE.test(o.time)) return 'The time must be HH:MM, for example 07:00.';
  if (!validTimeZone(o.timeZone)) return 'The time zone is not one the app knows.';
  if (!Array.isArray(o.questions)) return 'Questions are needed.';
  const qs = o.questions.filter((q) => typeof q === 'string' && q.trim());
  if (o.enabled && !qs.length) return 'Add at least one question.';
  if (qs.length > MAX_QUESTIONS) return `At most ${MAX_QUESTIONS} questions.`;
  if (qs.some((q) => q.length > MAX_QUESTION_CHARS)) return `Keep each question under ${MAX_QUESTION_CHARS} characters.`;
  if (o.watchlistId !== undefined && (typeof o.watchlistId !== 'string' || o.watchlistId.length > 120)) return 'Unknown watchlist.';
  return null;
}

export function cleanSettings(s: MorningBriefSettings): MorningBriefSettings {
  return {
    enabled: s.enabled,
    time: s.time,
    timeZone: s.timeZone,
    questions: s.questions.map((q) => q.trim()).filter(Boolean).slice(0, MAX_QUESTIONS),
    ...(s.watchlistId ? { watchlistId: s.watchlistId } : {}),
  };
}

export function parseMorningFile(raw: unknown): MorningBriefFile {
  const o = raw as Partial<MorningBriefFile> | null;
  const settings = o?.settings && !settingsProblem(o.settings) ? cleanSettings(o.settings as MorningBriefSettings) : { ...DEFAULT_SETTINGS };
  const lr = o?.lastRun;
  const lastRun = lr && typeof lr.at === 'string' && typeof lr.day === 'string' && Array.isArray(lr.results) ? (lr as MorningBriefRun) : undefined;
  const day = typeof o?.lastScheduledDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.lastScheduledDay) ? o.lastScheduledDay : undefined;
  return { settings, ...(lastRun ? { lastRun } : {}), ...(day ? { lastScheduledDay: day } : {}) };
}

/** Local day and time in a zone: { day: '2026-11-05', time: '07:30' }. */
export function localClock(now: Date, timeZone: string): { day: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Due when switched on, the local time has reached the set time, and the scheduled run has not happened today. */
export function isDue(file: MorningBriefFile, now: Date): boolean {
  const s = file.settings;
  if (!s.enabled || !s.questions.length) return false;
  const { day, time } = localClock(now, s.timeZone);
  return time >= s.time && file.lastScheduledDay !== day;
}

/** "Today at 07:00" / "Tomorrow at 07:00" / "Off", for the settings page. */
export function nextRunText(file: MorningBriefFile, now: Date): string {
  const s = file.settings;
  if (!s.enabled) return 'Off';
  const { day, time } = localClock(now, s.timeZone);
  const when = file.lastScheduledDay === day ? 'Tomorrow' : time >= s.time ? 'Due now, then daily' : 'Today';
  return `${when} at ${s.time} (${s.timeZone})`;
}

/** The question as saved, so the brief is easy to find among saved research. */
export function morningQuestion(q: string): string {
  return `Morning brief: ${q}`;
}
