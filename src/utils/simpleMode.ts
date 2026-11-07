/**
 * Report templates shown in Reports: the ones built on the role briefs. The other templates
 * (IC memo, client letter) belonged to the old desks, which ran on built-in figures and were
 * removed (Sam, 2026-11-04: no built-in figures), so links to them open the nearest one here.
 */
import type { ReportTemplate } from '../data/navigation';

export const CORE_REPORTS: ReportTemplate[] = ['economist', 'banker', 'official', 'book', 'client_review', 'council'];

/** The template to open: the requested one if it is shown, else its nearest shown template. */
export function visibleReport(report: ReportTemplate): ReportTemplate {
  if (CORE_REPORTS.includes(report)) return report;
  if (report === 'ic') return 'book';
  if (report === 'client') return 'client_review';
  return 'economist';
}
