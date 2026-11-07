/**
 * The standing notice on everything the app exports (council briefs and documents, policy memos,
 * reports, CSV downloads, backups). One wording, kept here, so every file says the same thing and a
 * test can check each exporter carries it. The policy memo keeps its own banner on top as well
 * (src/utils/reviewMemo.ts), which says whether its signals passed their backtests.
 */

/** The short form, for labels and the end of a line. */
export const RESEARCH_NOTICE = 'Research, not validated advice.';

/** The full line at the foot of every export. */
export const EXPORT_NOTICE =
  `${RESEARCH_NOTICE} Figures come only from public feeds, official series or your own files, each with its source and date; ` +
  'no model in the app has been independently validated, and each signal shows its pre-registered backtest verdict (Menu > Models & validation). ' +
  'Not investment advice or a recommendation to buy or sell any security. ' +
  "Each data source's own terms of use still apply to the figures (docs/DATA_LICENCES.md).";

/** True when a text already ends with the notice (so it is never added twice). */
export function hasNotice(text: string): boolean {
  return text.slice(-EXPORT_NOTICE.length - 40).includes(RESEARCH_NOTICE);
}

/** Markdown: the notice as the last paragraph, after a rule. Idempotent. */
export function withNotice(markdown: string): string {
  if (hasNotice(markdown)) return markdown;
  return `${markdown.replace(/\s+$/, '')}\n\n---\n\n_${EXPORT_NOTICE}_\n`;
}

/** CSV: a comment line to put first (readers that skip "#" lines skip it; Excel shows it as a row). */
export function csvNoticeLine(): string {
  const text = `# ${EXPORT_NOTICE}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
