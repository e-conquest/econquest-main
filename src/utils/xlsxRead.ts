/**
 * A small .xlsx reader: enough to read one worksheet of a plain data workbook (the World Bank
 * Pink Sheet) as rows of cell text. No new package: an .xlsx file is a zip of XML files, so this
 * reads the zip directory, inflates the two or three files it needs with the platform's
 * DecompressionStream (Node 18+ and every current browser), and reads the cells.
 *
 * Handles shared strings, inline strings and numbers. Ignores styles, formulas (uses the cached
 * value), merged cells and dates (the Pink Sheet writes its dates as text such as "2025M09").
 */

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** The zip's central directory: name, compression and where each file starts. Throws if not a zip. */
export function zipEntries(buf: Uint8Array): ZipEntry[] {
  // End of central directory record: signature 0x06054b50, within the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (u32(buf, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (u32(buf, p) !== 0x02014b50) throw new Error('bad zip directory');
    const method = u16(buf, p + 10);
    const compressedSize = u32(buf, p + 20);
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const commentLen = u16(buf, p + 32);
    const localOffset = u32(buf, p + 42);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One file from the zip as text, or null when it is not there. */
export async function zipText(buf: Uint8Array, entries: ZipEntry[], name: string): Promise<string | null> {
  const e = entries.find((x) => x.name === name);
  if (!e) return null;
  if (u32(buf, e.localOffset) !== 0x04034b50) throw new Error('bad zip entry');
  const start = e.localOffset + 30 + u16(buf, e.localOffset + 26) + u16(buf, e.localOffset + 28);
  const raw = buf.subarray(start, start + e.compressedSize);
  const bytes = e.method === 0 ? raw : e.method === 8 ? await inflateRaw(raw) : null;
  if (!bytes) throw new Error(`zip compression ${e.method} not supported`);
  return new TextDecoder().decode(bytes);
}

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

/** Text of every <t> in a run, joined (rich text keeps its pieces in several <t>s). */
const textOf = (xml: string) => unescapeXml([...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

export function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
}

/** "AB12" -> column index 27 (0-based). */
export function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] || 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Worksheet XML -> rows of cell text ('' for empty), in sheet order. */
export function parseSheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNum = Number(rm[1].match(/\br="(\d+)"/)?.[1]);
    const cells: string[] = [];
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] || '';
      const ref = attrs.match(/\br="([A-Z]+)\d*"/)?.[1];
      const col = ref ? columnIndex(ref) : cells.length;
      const type = attrs.match(/\bt="(\w+)"/)?.[1];
      let v = '';
      if (type === 'inlineStr') v = textOf(body);
      else {
        const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (raw !== undefined) v = type === 's' ? shared[Number(raw)] ?? '' : unescapeXml(raw);
      }
      while (cells.length < col) cells.push('');
      cells[col] = v;
    }
    if (Number.isFinite(rowNum) && rowNum > 0) while (rows.length < rowNum - 1) rows.push([]);
    rows.push(cells);
  }
  return rows;
}

/** The worksheet named `sheetName` (case-insensitive), as rows of text. Null when there is no such sheet. */
export async function readXlsxSheet(data: ArrayBuffer | Uint8Array, sheetName: string): Promise<string[][] | null> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const entries = zipEntries(buf);
  const workbook = await zipText(buf, entries, 'xl/workbook.xml');
  const rels = await zipText(buf, entries, 'xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) return null;
  const want = sheetName.toLowerCase();
  const sheet = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]).find((s) => unescapeXml(s.match(/\bname="([^"]*)"/)?.[1] || '').toLowerCase() === want);
  if (!sheet) return null;
  const rid = sheet.match(/\br:id="([^"]+)"/)?.[1];
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.match(/\bId="([^"]+)"/)?.[1] === rid);
  const target = rel?.match(/\bTarget="([^"]+)"/)?.[1];
  if (!target) return null;
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const sheetXml = await zipText(buf, entries, path);
  if (!sheetXml) return null;
  const sharedXml = await zipText(buf, entries, 'xl/sharedStrings.xml');
  return parseSheetRows(sheetXml, sharedXml ? parseSharedStrings(sharedXml) : []);
}

/** Every worksheet's name, in workbook order. */
export async function xlsxSheetNames(data: ArrayBuffer | Uint8Array): Promise<string[]> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const workbook = await zipText(buf, zipEntries(buf), 'xl/workbook.xml');
  if (!workbook) return [];
  return [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => unescapeXml(m[0].match(/\bname="([^"]*)"/)?.[1] || '')).filter(Boolean);
}
