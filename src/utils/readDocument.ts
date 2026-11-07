/** Read an uploaded file's text in the browser. PDFs use pdf.js, loaded only when a PDF is added. */
import { MAX_DOC_CHARS } from './policyDocs';

export async function readDocumentFile(file: File): Promise<{ text: string; pages?: number }> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) return { text: (await file.text()).slice(0, MAX_DOC_CHARS) };
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  let size = 0;
  for (let n = 1; n <= pdf.numPages && size < MAX_DOC_CHARS; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const text = pdfPageText(content.items as any[]);
    pages.push(text);
    size += text.length;
  }
  return { text: pages.join('\n\n').slice(0, MAX_DOC_CHARS), pages: pdf.numPages };
}

/**
 * One page's text. Lines keep their breaks; a vertical gap well over the line height (a blank line
 * in the layout) becomes a paragraph break, so passages follow the document's paragraphs.
 */
export function pdfPageText(items: Array<{ str?: string; hasEOL?: boolean; transform?: number[]; height?: number }>): string {
  let out = '';
  let lastY: number | undefined;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const y = it.transform?.[5];
    const h = it.height || 0;
    if (lastY !== undefined && y !== undefined && h > 0 && lastY - y > 1.7 * h && !out.endsWith('\n\n')) out += out.endsWith('\n') ? '\n' : '\n\n';
    out += it.str + (it.hasEOL ? '\n' : '');
    if (it.str.trim() && y !== undefined) lastY = y;
  }
  return out;
}
