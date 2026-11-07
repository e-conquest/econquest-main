/**
 * A research notebook as one Markdown file: your notes, then each saved conversation as its full
 * council brief (figures keep their sources and reference lists), then each document's title and
 * opening passage. Browser-safe; the server builds the download.
 */
import { councilBriefMarkdown } from './briefExport';
import type { PolicyDoc } from './policyDocs';
import type { Notebook, SavedBriefEntry } from './researchLibrary';
import { withNotice } from './disclaimer';

/** Characters of each document quoted in the export; the full text stays in the app. */
export const NOTEBOOK_DOC_EXCERPT = 1500;

/** Push every Markdown heading down two levels so a brief sits under the notebook's own headings. */
const demote = (md: string) => md.replace(/^(#{1,4}) /gm, (_m, h: string) => `${h}## `);

export function notebookMarkdown(nb: Notebook, briefs: SavedBriefEntry[], docs: PolicyDoc[], now: Date = new Date()): string {
  const inBriefs = nb.briefIds.map((id) => briefs.find((b) => b.id === id)).filter((b): b is SavedBriefEntry => Boolean(b));
  const inDocs = nb.docIds.map((id) => docs.find((d) => d.id === id)).filter((d): d is PolicyDoc => Boolean(d));
  const lines: string[] = [
    `# ${nb.title}`,
    '',
    `Research notebook. Started ${nb.createdAt.slice(0, 10)}, last changed ${nb.updatedAt.slice(0, 10)}, exported ${now.toISOString().slice(0, 10)}.`,
    '',
    '## Notes',
    '',
    nb.notes.trim() || '_No notes yet._',
    '',
    '## Contents',
    '',
    ...(inBriefs.length ? inBriefs.map((b, i) => `${i + 1}. ${b.question} (asked ${b.askedAt.slice(0, 10)})`) : ['_No saved conversations in this notebook._']),
    ...(inDocs.length ? ['', ...inDocs.map((d) => `- Document: ${d.title}${d.pages ? `, ${d.pages} pages` : ''} (added ${d.addedAt.slice(0, 10)})`)] : []),
    '',
  ];
  inBriefs.forEach((b, i) => {
    lines.push(`## ${i + 1}. ${b.question}`, '', `Asked ${b.askedAt.slice(0, 16).replace('T', ' ')} UTC.`, '', demote(councilBriefMarkdown(b)), '');
  });
  for (const d of inDocs) {
    const text = d.text.trim();
    const cut = text.length > NOTEBOOK_DOC_EXCERPT;
    lines.push(`## Document: ${d.title}`, '', `Added ${d.addedAt.slice(0, 10)}${d.pages ? `, ${d.pages} pages` : ''}. ${cut ? `Opening ${NOTEBOOK_DOC_EXCERPT.toLocaleString('en-US')} of ${text.length.toLocaleString('en-US')} characters; the full text is kept in the app.` : 'Full text.'}`, '');
    lines.push(...(cut ? text.slice(0, NOTEBOOK_DOC_EXCERPT) + ' …' : text).split(/\r?\n/).map((l) => (l.trim() ? `> ${l}` : '>')), '');
  }
  return withNotice(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n');
}

/** e.g. notebook-brazil-fiscal-2026-11-05.md */
export function notebookFileName(nb: Notebook, now: Date = new Date()): string {
  const slug =
    nb.title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'notebook';
  return `notebook-${slug}-${now.toISOString().slice(0, 10)}.md`;
}
