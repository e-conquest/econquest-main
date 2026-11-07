import type { SavedCouncilBrief } from './askCouncil';
import { councilBriefSections } from './askCouncil';
import { EXPORT_NOTICE } from './disclaimer';

/**
 * Download a council brief as Markdown or PDF. Every agent figure carries its source and date in
 * the text (askCouncil.councilBriefSections), so the file stands on its own when shared.
 */

const DISCLAIMER = EXPORT_NOTICE;

export function councilBriefMarkdown(b: SavedCouncilBrief): string {
  return [
    '# Council brief',
    '',
    ...councilBriefSections(b, () => true).flatMap((s) => [`## ${s.heading}`, '', ...s.lines.flatMap((l) => (l.startsWith('- ') || l.startsWith('  - ') ? [l] : [l, ''])), '']),
    '---',
    '',
    `_${DISCLAIMER}_`,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** e.g. council-brief-2026-11-05-is-brazils-debt-sustainable */
export function briefFileName(b: SavedCouncilBrief): string {
  const slug = b.question
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
  return `council-brief-${b.askedAt.slice(0, 10)}${slug ? `-${slug}` : ''}`;
}

/** The PDF fonts cover Latin-1 only: swap the few typographic characters the briefs use. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/→/g, '->')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/…/g, '...')
    .replace(/·/g, '-')
    .replace(/ /g, ' ')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '?');
}

/** Builds the PDF and returns its bytes. */
export async function councilBriefPdf(b: SavedCouncilBrief): Promise<ArrayBuffer> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 18;
  const width = 210 - margin * 2;
  const bottom = 297 - 18;
  let y = margin;
  const write = (text: string, size: number, style: 'normal' | 'bold' | 'italic', gap: number, indent = 0) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    const lines: string[] = doc.splitTextToSize(pdfSafe(text), width - indent);
    const lh = size * 0.42;
    for (const line of lines) {
      if (y + lh > bottom) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin + indent, y);
      y += lh;
    }
    y += gap;
  };

  write('Council brief', 16, 'bold', 3);
  for (const s of councilBriefSections(b, () => true)) {
    write(s.heading, 12, 'bold', 1.5);
    for (const raw of s.lines) {
      if (!raw.trim()) {
        y += 1.5;
        continue;
      }
      const sub = raw.startsWith('  - ');
      const bullet = sub || raw.startsWith('- ');
      const text = raw.replace(/^\s*- /, '').replace(/\*\*/g, '');
      const bold = /^\*\*.*\*\*$/.test(raw.trim());
      write(bullet ? `- ${text}` : text, 10, bold ? 'bold' : 'normal', 1, sub ? 8 : bullet ? 3 : 0);
    }
    y += 2;
  }
  write(DISCLAIMER, 8, 'italic', 0);
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(pdfSafe(`EconQuest council brief - asked ${b.askedAt.slice(0, 16).replace('T', ' ')} UTC - page ${i} of ${pages}`), margin, 297 - 8);
  }
  return doc.output('arraybuffer');
}

/** Hands the browser a file to save. */
export function saveFile(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadCouncilBrief(b: SavedCouncilBrief, format: 'md' | 'pdf'): Promise<void> {
  const name = `${briefFileName(b)}.${format}`;
  if (format === 'md') saveFile(name, councilBriefMarkdown(b), 'text/markdown;charset=utf-8');
  else saveFile(name, await councilBriefPdf(b), 'application/pdf');
}
