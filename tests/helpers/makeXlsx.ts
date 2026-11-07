/**
 * Builds a minimal real .xlsx in memory (a zip of the XML parts) for tests, using Node's zlib.
 * Cells are text (shared strings) or numbers; one worksheet per call.
 */
import zlib from 'node:zlib';

function zip(files: Array<{ name: string; data: Buffer; store?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const body = f.store ? f.data : zlib.deflateRawSync(f.data);
    const crc = zlib.crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(f.store ? 0 : 8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(f.store ? 0 : 8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** rows: cells as string (text) or number; '' or null = empty. */
export function makeXlsx(sheetName: string, rows: Array<Array<string | number | null>>, opts: { otherSheetFirst?: boolean } = {}): Uint8Array {
  const shared: string[] = [];
  const sIdx = (t: string) => {
    let i = shared.indexOf(t);
    if (i < 0) i = shared.push(t) - 1;
    return i;
  };
  const rowXml = rows
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => {
          if (v === null || v === '') return '';
          const ref = `${col(ci)}${ri + 1}`;
          return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${sIdx(v)}</v></c>`;
        })
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
  const sst = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map((t) => `<si><t>${esc(t)}</t></si>`).join('')}</sst>`;
  const sheets = opts.otherSheetFirst
    ? `<sheet name="Index" sheetId="1" r:id="rId1"/><sheet name="${esc(sheetName)}" sheetId="2" r:id="rId2"/>`
    : `<sheet name="${esc(sheetName)}" sheetId="1" r:id="rId2"/>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="ws" Target="worksheets/sheet2.xml"/></Relationships>`;
  const empty = `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>index</t></is></c></row></sheetData></worksheet>`;
  return new Uint8Array(
    zip([
      { name: 'xl/workbook.xml', data: Buffer.from(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(rels), store: true },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(empty) },
      { name: 'xl/worksheets/sheet2.xml', data: Buffer.from(sheet) },
      { name: 'xl/sharedStrings.xml', data: Buffer.from(sst) },
    ])
  );
}

/** A Pink Sheet "Monthly Prices" layout with months from 2023M01, one column per given code. */
export function pinkSheetRows(cols: Array<{ code: string; heading: string; unit: string; values: number[] }>, startYear = 2023): Array<Array<string | number | null>> {
  const n = Math.max(...cols.map((c) => c.values.length));
  const rows: Array<Array<string | number | null>> = [
    ['World Bank Commodity Price Data (The Pink Sheet)'],
    ['monthly prices in nominal US dollars, 1960 to present'],
    [],
    ['Updated on November 03, 2026'],
    [null, ...cols.map((c) => c.heading)],
    [null, ...cols.map((c) => `(${c.unit})`)],
    [null, ...cols.map((c) => c.code)],
  ];
  for (let i = 0; i < n; i++) {
    const y = startYear + Math.floor(i / 12);
    const m = String((i % 12) + 1).padStart(2, '0');
    rows.push([`${y}M${m}`, ...cols.map((c) => (c.values[i] === undefined ? '…' : c.values[i]))]);
  }
  return rows;
}
