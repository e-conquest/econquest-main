/**
 * Excel downloads: the same tables as the CSV files (one row per value, with unit, source and
 * dates; "Missing" and the reason where a value is missing), written as a minimal .xlsx workbook.
 * Numbers stay numbers, text is stored as text (so nothing is ever run as a formula), the header
 * row is bold and frozen, and a second sheet says what the file is and where it came from.
 *
 * Built with fflate (zip). Browser-safe, but the server builds the files.
 */
import { zipSync, strToU8 } from 'fflate';
import { EXPORT_NOTICE } from './disclaimer';

type Cell = string | number | null | undefined;

export interface XlsxSheet {
  name: string;
  header: string[];
  rows: Cell[][];
}

// XML 1.0 forbids most control characters; drop them and escape the rest.
const xml = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Column letters: 0 -> A, 25 -> Z, 26 -> AA. */
export function colName(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Excel sheet names: at most 31 characters, none of : \ / ? * [ ]. */
export function sheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Sheet';
}

function cellXml(v: Cell, ref: string, style = 0): string {
  const s = style ? ` s="${style}"` : '';
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"${s}><v>${v}</v></c>` : '';
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
}

function sheetXml(sh: XlsxSheet): string {
  const rows = [sh.header, ...sh.rows];
  const widths = sh.header.map((h, c) => Math.min(60, Math.max(8, ...rows.slice(0, 500).map((r) => String(r[c] ?? '').length)) + 2));
  const body = rows
    .map((r, i) => `<row r="${i + 1}">${r.map((v, c) => cellXml(v, `${colName(c)}${i + 1}`, i === 0 ? 1 : 0)).join('')}</row>`)
    .join('');
  const last = `${colName(Math.max(0, sh.header.length - 1))}${rows.length}`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${last}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${body}</sheetData>` +
    (rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : '') +
    '</worksheet>'
  );
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** A workbook from one or more sheets. */
export function toXlsx(sheets: XlsxSheet[]): Uint8Array {
  const names = sheets.map((s, i) => {
    const base = sheetName(s.name);
    return sheets.slice(0, i).some((p) => sheetName(p.name) === base) ? `${base.slice(0, 28)} ${i + 1}` : base;
  });
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
        '</workbook>'
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>'
    ),
    'xl/styles.xml': strToU8(STYLES),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });
  return zipSync(files, { level: 6 });
}

/** The data sheet plus an "About" sheet naming what the file holds and when it was made. */
export function tableWorkbook(title: string, header: string[], rows: Cell[][], now: Date = new Date()): Uint8Array {
  return toXlsx([
    { name: 'Data', header, rows },
    {
      name: 'About',
      header: ['field', 'value'],
      rows: [
        ['file', title],
        ['made', now.toISOString()],
        ['rows', rows.length],
        ['missing values', 'A missing value says Missing with its reason; nothing is filled in.'],
        ['sources', 'Each row names its own source and dates.'],
        ['notice', EXPORT_NOTICE],
      ],
    },
  ]);
}
