/** PDF of a policy review memo (browser only: jspdf is loaded when asked for). */
import { pdfSafe } from './briefExport';
import { RESEARCH_BANNER, VALIDATED_BANNER, type MemoStep } from './reviewMemo';
import { EXPORT_NOTICE } from './disclaimer';

export async function memoPdf(memo: MemoStep, savedAt: string, hash: string): Promise<ArrayBuffer> {
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
  write(memo.title, 15, 'bold', 3);
  write(memo.researchOnly ? RESEARCH_BANNER : VALIDATED_BANNER, 9, 'italic', 3);
  for (const s of memo.sections) {
    write(s.heading, 12, 'bold', 1.5);
    for (const raw of s.lines) {
      if (!raw.trim()) {
        y += 1.5;
        continue;
      }
      const bullet = raw.startsWith('- ');
      write(raw.replace(/\*\*/g, ''), 10, 'normal', 1, bullet ? 3 : 0);
    }
    y += 2;
  }
  write(EXPORT_NOTICE, 8, 'italic', 0);
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(pdfSafe(`EconQuest policy memo - saved ${savedAt.slice(0, 16).replace('T', ' ')} UTC - hash ${hash.slice(0, 12)} - page ${i} of ${pages}`), margin, 297 - 8);
  }
  return doc.output('arraybuffer');
}
