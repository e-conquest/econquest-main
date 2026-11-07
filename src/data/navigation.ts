/**
 * The main navigation. One layout for everyone: the role picker was removed at Sam's request
 * (2026-11-04). The app opens on Workspace; each page opens on its general-purpose tab and has
 * its own switch for the economist, banker or official-sector view.
 */
/**
 * 'research' is one header entry for three scopes: one country, compare countries and your
 * holdings (Sam, 2026-11-05). The old areas 'country', 'compare' and 'portfolio' are still the
 * page's internal scopes, so every link that opened them lands on the right part of Research.
 */
export type WorkflowArea = 'today' | 'research' | 'reports' | 'desks';
/** Which report template opens first on Reports > Memos and notes. */
export type ReportTemplate = 'ic' | 'client' | 'economist' | 'banker' | 'official' | 'book' | 'client_review' | 'council';

export const NAV: WorkflowArea[] = ['today', 'research', 'reports', 'desks'];

export const NAV_LABEL: Record<WorkflowArea, string> = {
  today: 'Workspace',
  research: 'Research',
  reports: 'Reports',
  desks: 'Tools',
};

/** The council brief: what Council chat on Workspace produces. */
export const DEFAULT_REPORT: ReportTemplate = 'council';
/** Research > One country opens on Summary, the brief (economist view; banker and official views one click away). */
export const DEFAULT_COUNTRY_TAB_ID = 'brief';
