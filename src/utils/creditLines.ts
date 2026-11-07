/**
 * Everything that leaves the app as a picture or a file goes through here: the credit each source
 * asks for in its own terms (the licence register, src/data/dataLicences.ts), the sources whose
 * terms hold an export back, and the framed SVG that carries title, sources and credits with the
 * chart. Used by the Chart Agent's Image and CSV (components/CouncilChart.tsx), Publish chart
 * (components/PublishChartButton.tsx) and the replication pack.
 *
 *   creditsFor        credit lines plus the sources Sharing mode holds back (register share field)
 *   publicationCheck  credit lines plus the sources that block Publish chart until the user ticks
 *                     they hold permission, those with unclear terms and those not in the register
 *   framedSvg         one stand-alone SVG: title (and subtitle) above the chart, footer lines below
 *
 * Browser-safe, pure.
 */
import { LICENCE_SHARE_LABEL, LICENCE_STATUS_LABEL, type LicenceRow } from '../data/dataLicences';
import { licenceRowsForSource } from './licenceLookup';

// ---------------------------------------------------------------------------------------------
// Credit lines

/** The register's attribution with its first "<...>" placeholder filled from the source text and examples dropped. */
export function creditLine(row: LicenceRow, source: string): string {
  let a = row.attribution.replace(/,?\s*e\.g\.\s.*$/i, '').trim();
  if (!a || /^none stated\.?$/i.test(a)) return `Source: ${row.name}.`;
  let first = true;
  a = a.replace(/[,:;]?\s*<[^>]+>/g, (m) => {
    if (!first) return '';
    first = false;
    return `${/^[,:;]/.test(m) ? `${m[0]} ` : ' '}${source.trim()}`;
  });
  a = a.replace(/\s+/g, ' ').replace(/\s+([.,])/g, '$1').trim();
  return /[.)"]$/.test(a) ? a : `${a}.`;
}

/** Register rows for the sources, each once (the first source text that names it fills its credit). */
function rowsFor(sources: Array<string | undefined>): Array<{ row: LicenceRow; source: string }> {
  const seen = new Set<string>();
  const out: Array<{ row: LicenceRow; source: string }> = [];
  for (const raw of sources) {
    const source = (raw || '').trim();
    if (!source) continue;
    for (const row of licenceRowsForSource(source)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push({ row, source });
    }
  }
  return out;
}

export interface ExportCredits {
  /** One line per register source, as its terms ask to be credited. */
  credits: string[];
  /** Sources not marked "Can be passed on" in the register (Sharing mode holds these back). */
  notShareable: string[];
}

/** A source the register does not name is the app's own calculation: no credit, nothing held back. */
export function creditsFor(sources: Array<string | undefined>): ExportCredits {
  const rows = rowsFor(sources);
  return { credits: rows.map(({ row, source }) => creditLine(row, source)), notShareable: rows.filter(({ row }) => row.share !== 'allowed').map(({ row }) => row.name) };
}

/** Why Sharing mode refuses this export, or null when it may go out. */
export function shareModeBlock(sources: Array<string | undefined>, shareMode: boolean): string | null {
  if (!shareMode) return null;
  const { notShareable } = creditsFor(sources);
  return notShareable.length ? `Sharing mode is on and this uses ${notShareable.join('; ')}, whose terms do not let the figures be passed on, or do not say (Menu > About & data licences).` : null;
}

export interface PublicationCheck {
  credits: string[];
  /** Rows that block Publish chart until the user says they hold permission, with why. */
  blocked: Array<{ id: string; name: string; why: string }>;
  /** Rows whose sharing terms are unclear (export allowed, with a note). */
  unclear: Array<{ id: string; name: string; why: string }>;
  /** Source texts that name no register row: flagged, not guessed. */
  unmapped: string[];
}

export function publicationCheck(sources: string[]): PublicationCheck {
  const blocked: PublicationCheck['blocked'] = [];
  const unclear: PublicationCheck['unclear'] = [];
  const unmapped = [...new Set(sources.map((s) => s.trim()).filter((s) => s && !licenceRowsForSource(s).length))];
  const rows = rowsFor(sources);
  for (const { row: r } of rows) {
    const why = `${LICENCE_STATUS_LABEL[r.status]}; ${LICENCE_SHARE_LABEL[r.share].toLowerCase()}. ${r.shareNote}`.trim();
    if (r.share === 'restricted' || (r.status === 'permission' && r.share !== 'allowed')) blocked.push({ id: r.id, name: r.name, why });
    else if (r.share === 'unclear' || r.status === 'not_verified') unclear.push({ id: r.id, name: r.name, why });
  }
  return { credits: rows.map(({ row, source }) => creditLine(row, source)), blocked, unclear, unmapped };
}

// ---------------------------------------------------------------------------------------------
// The framed SVG

/** Breaks text into lines of at most `width` characters, at spaces. */
export function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface Frame {
  title: string;
  subtitle?: string;
  /** Lines under the chart (sources, period, credits, notice), each wrapped to the width. */
  footer: string[];
}

/**
 * A stand-alone SVG on white: title and subtitle on top, the chart's own <svg> (as text) nested at
 * its size, every footer line under it, so the picture carries its sources wherever it is pasted.
 * currentColor in the chart becomes a dark grey, since the file has no page colour to inherit.
 */
export function framedSvg(chartSvg: string, width: number, height: number, frame: Frame): string {
  const pad = 16;
  const per = Math.max(40, Math.floor((width - 2 * pad) / 6.4));
  const head = [{ t: frame.title, size: 15, weight: 600 }, ...(frame.subtitle ? [{ t: frame.subtitle, size: 12, weight: 400 }] : [])].flatMap((h) => wrapText(h.t, Math.floor(per * (12 / h.size))).map((t) => ({ ...h, t })));
  const lines: string[] = [];
  let y = pad;
  for (const h of head) {
    y += h.size + 4;
    lines.push(`<text x="${pad}" y="${y}" font-size="${h.size}" font-weight="${h.weight}" fill="#0f172a">${esc(h.t)}</text>`);
  }
  const chartY = y + 8;
  const inner = chartSvg.replace(/currentColor/g, '#475569').replace(/^<svg\b/, `<svg x="0" y="${chartY}"`);
  y = chartY + height + 6;
  for (const t of frame.footer.filter(Boolean).flatMap((f) => wrapText(f, per))) {
    y += 14;
    lines.push(`<text x="${pad}" y="${y}" font-size="11" fill="#475569">${esc(t)}</text>`);
  }
  const total = y + pad;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${total}" viewBox="0 0 ${width} ${total}" font-family="Inter, Helvetica, Arial, sans-serif">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    ...lines,
    inner,
    `</svg>`,
  ].join('\n');
}

/** Publish chart's footer: source, period and as-of date, then the credit line. */
export function publicationFooter(meta: { source: string; period: string; asOf: string; credit: string }): string[] {
  return [`Source: ${meta.source.replace(/^source:\s*/i, '')}`, `Period: ${meta.period}. As of ${meta.asOf}.`, meta.credit ? `Credit: ${meta.credit.replace(/^source:\s*/i, '')}` : ''].filter(Boolean);
}

export const PUBLICATION_METHOD =
  "The chart is redrawn on white with its title, the figure's source, the period shown, the date of the export and a credit line built from the attribution each source asks for in the licence register. A source whose terms restrict free sharing, or need permission where sharing is not settled, blocks the export until you tick that you hold permission; sources with unclear terms or not in the register are named. You are responsible for the terms of what you publish.";
