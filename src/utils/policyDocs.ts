/**
 * Policy documents you add to Council chat (Sam, 2026-11-05): an MPC statement, an IMF staff
 * report, a budget speech. The Policy Document Agent answers with the passages that best match
 * the question, quoted word for word, so every figure it brings is one printed in your document.
 *
 * Matching is stated rules (shared words between question and passage), not AI, so the reason a
 * passage was picked is visible: the matched words are listed with it.
 */

export interface PolicyDoc {
  id: string;
  title: string;
  text: string;
  addedAt: string;
  /** Pages read, for PDFs. */
  pages?: number;
}

export interface DocHit {
  docId: string;
  title: string;
  /** Position of the passage in the document, from 1. */
  part: number;
  parts: number;
  text: string;
  matched: string[];
  score: number;
}

export const MAX_DOCS = 5;
export const MAX_DOC_CHARS = 400_000;
const MAX_PASSAGE = 700;
const MIN_PASSAGE = 80;

const STOP = new Set(
  (
    'the and for are but not you all any can had her was one our out has have him his how its may new now old see two way who did get let put say she too use what when where which while with will would could should about after again also been before being both does each from into just more most much only other over same some such than that them then there these they this those through under very were your their whether is it in on of to a an as at be by or if so do we us me my no up am'
  ).split(' ')
);

/** The words of a question worth matching on: no stop words, at least three letters. */
export function questionTerms(question: string): string[] {
  const words = question.toLowerCase().match(/[\p{L}][\p{L}\d'-]*/gu) || [];
  return [...new Set(words.map((w) => w.replace(/'s$/, '')).filter((w) => w.length >= 3 && !STOP.has(w)))];
}

/** Split a document into passages: paragraphs, with short ones joined and long ones cut at sentence ends. */
export function passages(text: string): string[] {
  const paras = text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const joined: string[] = [];
  for (const p of paras) {
    const last = joined[joined.length - 1];
    if (last !== undefined && last.length < MIN_PASSAGE) joined[joined.length - 1] = `${last} ${p}`;
    else joined.push(p);
  }
  const out: string[] = [];
  for (const p of joined) {
    if (p.length <= MAX_PASSAGE) {
      out.push(p);
      continue;
    }
    let cur = '';
    for (const s of p.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [p]) {
      if (cur && cur.length + s.length > MAX_PASSAGE) {
        out.push(cur.trim());
        cur = '';
      }
      cur += s;
      while (cur.length > MAX_PASSAGE * 1.5) {
        out.push(cur.slice(0, MAX_PASSAGE).trim());
        cur = cur.slice(MAX_PASSAGE);
      }
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

/** A question word matches a passage word when they share their first five letters (rate/rates, inflation/inflationary). */
function matches(term: string, words: Set<string>): boolean {
  if (words.has(term)) return true;
  if (term.length < 5) return false;
  const stem = term.slice(0, 5);
  for (const w of words) if (w.startsWith(stem)) return true;
  return false;
}

/** The passages that share the most question words, best first. A passage needs two shared words, or one when the question has only one. */
export function searchDocs(question: string, docs: PolicyDoc[], k = 3): DocHit[] {
  const terms = questionTerms(question);
  if (!terms.length) return [];
  const need = Math.min(2, terms.length);
  const hits: DocHit[] = [];
  for (const d of docs) {
    const ps = passages(d.text);
    ps.forEach((text, i) => {
      const words = new Set((text.toLowerCase().match(/[\p{L}][\p{L}\d'-]*/gu) || []).map((w) => w.replace(/'s$/, '')));
      const matched = terms.filter((t) => matches(t, words));
      if (matched.length >= need) hits.push({ docId: d.id, title: d.title, part: i + 1, parts: ps.length, text, matched, score: matched.length / terms.length });
    });
  }
  return hits.sort((a, b) => b.score - a.score || a.part - b.part).slice(0, k);
}

/** Tidy a file name into a title. */
export function docTitle(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled document';
}
