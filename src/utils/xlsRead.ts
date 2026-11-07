/**
 * A small reader for old Excel 97-2003 workbooks (.xls: BIFF8 inside an OLE2 compound file), enough
 * for plain data sheets such as the NY Fed GSCPI download, which is served as .xls even at its .csv
 * address. No new package.
 *
 * Reads numbers (NUMBER, RK, MULRK, cached FORMULA results) and text (shared strings via LABELSST,
 * and LABEL). Dates stored as dates come back as Excel serial days; dates typed as text come back as
 * text. Ignores styles, merged cells and everything else.
 *
 * Browser-safe, pure.
 */

const OLE_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END = 0xfffffffe;

export function isOleFile(buf: Uint8Array): boolean {
  return buf.length >= 512 && OLE_SIG.every((b, i) => buf[i] === b);
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** The named stream ("Workbook" or "Book") of an OLE2 compound file, or null. */
export function oleStream(buf: Uint8Array, names: string[]): Uint8Array | null {
  if (!isOleFile(buf)) return null;
  const sectorSize = 1 << u16(buf, 0x1e);
  const miniSize = 1 << u16(buf, 0x20);
  const firstDir = u32(buf, 0x30);
  const cutoff = u32(buf, 0x38);
  const firstMiniFat = u32(buf, 0x3c);
  let difatNext = u32(buf, 0x44);
  const sector = (id: number) => (id + 1) * sectorSize;
  // FAT sector list: 109 in the header, then chained DIFAT sectors.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const id = u32(buf, 0x4c + i * 4);
    if (id < 0xfffffffa) fatSectors.push(id);
  }
  const per = sectorSize / 4;
  for (let guard = 0; difatNext < 0xfffffffa && guard < 10000; guard++) {
    const o = sector(difatNext);
    if (o + sectorSize > buf.length) break;
    for (let i = 0; i < per - 1; i++) {
      const id = u32(buf, o + i * 4);
      if (id < 0xfffffffa) fatSectors.push(id);
    }
    difatNext = u32(buf, o + (per - 1) * 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors) {
    const o = sector(s);
    if (o + sectorSize > buf.length) return null;
    for (let i = 0; i < per; i++) fat.push(u32(buf, o + i * 4));
  }
  const chain = (start: number, table: number[]) => {
    const out: number[] = [];
    for (let id = start; id < 0xfffffffa && out.length <= table.length; id = table[id] ?? END) out.push(id);
    return out;
  };
  const read = (start: number, size: number) => {
    const ids = chain(start, fat);
    const out = new Uint8Array(ids.length * sectorSize);
    ids.forEach((id, k) => out.set(buf.subarray(sector(id), sector(id) + sectorSize), k * sectorSize));
    return out.subarray(0, Math.min(size, out.length));
  };
  const dirIds = chain(firstDir, fat);
  const dir = read(firstDir, dirIds.length * sectorSize);
  const entries: Array<{ name: string; type: number; start: number; size: number }> = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const len = u16(dir, o + 0x40);
    let name = '';
    for (let i = 0; i + 1 < len - 1 && i < 64; i += 2) name += String.fromCharCode(u16(dir, o + i));
    entries.push({ name, type: dir[o + 0x42], start: u32(dir, o + 0x74), size: u32(dir, o + 0x78) });
  }
  const want = names.map((n) => n.toLowerCase());
  const hit = entries.find((e) => e.type === 2 && want.includes(e.name.toLowerCase()));
  if (!hit) return null;
  if (hit.size >= cutoff) return read(hit.start, hit.size);
  // Small stream: in the mini stream (the root entry's data), sectors from the mini FAT.
  const root = entries.find((e) => e.type === 5);
  if (!root) return null;
  const miniStream = read(root.start, root.size);
  const miniFatIds = chain(firstMiniFat, fat);
  const miniFat: number[] = [];
  for (const s of miniFatIds) for (let i = 0; i < per; i++) miniFat.push(u32(buf, sector(s) + i * 4));
  const ids = chain(hit.start, miniFat);
  const out = new Uint8Array(ids.length * miniSize);
  ids.forEach((id, k) => out.set(miniStream.subarray(id * miniSize, (id + 1) * miniSize), k * miniSize));
  return out.subarray(0, hit.size);
}

/** An RK number (Excel's packed 30-bit number). */
export function rkValue(rk: number): number {
  let v: number;
  if (rk & 0x02) v = (rk | 0) >> 2;
  else {
    const b = new DataView(new ArrayBuffer(8));
    b.setUint32(0, 0, true);
    b.setUint32(4, rk & 0xfffffffc, true);
    v = b.getFloat64(0, true);
  }
  return rk & 0x01 ? v / 100 : v;
}


/** The shared string table: an SST record and the CONTINUE records after it, as one list of strings. */
export function parseSst(segments: Uint8Array[]): string[] {
  const out: string[] = [];
  if (!segments.length || segments[0].length < 8) return out;
  let seg = 0;
  let pos = 8;
  const total = u32(segments[0], 4);
  const avail = () => segments[seg].length - pos;
  const next = () => {
    seg++;
    pos = 0;
    return seg < segments.length;
  };
  const byte = () => {
    while (avail() <= 0) if (!next()) throw new Error('end');
    return segments[seg][pos++];
  };
  const word = () => byte() | (byte() << 8);
  const dword = () => (word() | (word() << 16)) >>> 0;
  const skip = (n: number) => {
    while (n > 0) {
      if (avail() <= 0 && !next()) throw new Error('end');
      const k = Math.min(n, avail());
      pos += k;
      n -= k;
    }
  };
  try {
    for (let i = 0; i < total; i++) {
      const cch = word();
      let flags = byte();
      const runs = flags & 0x08 ? word() : 0;
      const ext = flags & 0x04 ? dword() : 0;
      let str = '';
      let left = cch;
      while (left > 0) {
        if (avail() <= 0) {
          if (!next()) throw new Error('end');
          flags = segments[seg][pos++]; // a CONTINUE inside the characters starts with a new flags byte
        }
        const high = flags & 0x01;
        const n = Math.min(left, high ? Math.floor(avail() / 2) : avail());
        if (n <= 0) {
          if (!next()) throw new Error('end');
          flags = segments[seg][pos++];
          continue;
        }
        for (let k = 0; k < n; k++) str += String.fromCharCode(high ? u16(segments[seg], pos + k * 2) : segments[seg][pos + k]);
        pos += n * (high ? 2 : 1);
        left -= n;
      }
      skip(runs * 4 + ext);
      out.push(str);
    }
  } catch {
    // a short table: keep what was read
  }
  return out;
}

/** A BIFF8 LABEL cell's string (XLUnicodeString at `o`). */
function labelText(b: Uint8Array, o: number, end: number): string {
  const cch = u16(b, o);
  const high = b[o + 2] & 0x01;
  let s = '';
  for (let k = 0, p = o + 3; k < cch && p < end; k++, p += high ? 2 : 1) s += String.fromCharCode(high ? u16(b, p) : b[p]);
  return s;
}

/** Every worksheet of a .xls file as rows of cell text (numbers only; text cells empty). Null if not a .xls. */
export function readXlsSheets(data: ArrayBuffer | Uint8Array): string[][][] | null {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const wb = oleStream(buf, ['Workbook', 'Book']);
  if (!wb) return null;
  const view = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);
  const sheets: string[][][] = [];
  let cur: string[][] | null = null;
  // Shared strings first: the SST record and its CONTINUE records, in the workbook globals.
  const sstSegs: Uint8Array[] = [];
  for (let p = 0, inSst = false; p + 4 <= wb.length; ) {
    const type = u16(wb, p);
    const len = u16(wb, p + 2);
    if (p + 4 + len > wb.length) break;
    if (type === 0x00fc) {
      inSst = true;
      sstSegs.push(wb.subarray(p + 4, p + 4 + len));
    } else if (inSst && type === 0x003c) sstSegs.push(wb.subarray(p + 4, p + 4 + len));
    else if (inSst) break;
    p += 4 + len;
  }
  const sst = parseSst(sstSegs);
  const set = (row: number, col: number, text: string) => {
    if (!cur) return;
    while (cur.length <= row) cur.push([]);
    const r = cur[row];
    while (r.length < col) r.push('');
    r[col] = text;
  };
  const put = (row: number, col: number, v: number) => {
    if (Number.isFinite(v)) set(row, col, String(v));
  };
  for (let p = 0; p + 4 <= wb.length; ) {
    const type = u16(wb, p);
    const len = u16(wb, p + 2);
    const d = p + 4;
    if (d + len > wb.length) break;
    if (type === 0x0809) {
      const kind = u16(wb, d + 2);
      cur = kind === 0x0010 ? [] : null;
      if (cur) sheets.push(cur);
    } else if (type === 0x000a) cur = null; // EOF
    else if (cur && type === 0x0203 && len >= 14) put(u16(wb, d), u16(wb, d + 2), view.getFloat64(d + 6, true));
    else if (cur && type === 0x027e && len >= 10) put(u16(wb, d), u16(wb, d + 2), rkValue(u32(wb, d + 6)));
    else if (cur && type === 0x00bd && len >= 6) {
      const row = u16(wb, d);
      const first = u16(wb, d + 2);
      const n = (len - 6) / 6;
      for (let k = 0; k < n; k++) put(row, first + k, rkValue(u32(wb, d + 4 + k * 6 + 2)));
    } else if (cur && type === 0x0006 && len >= 14 && u16(wb, d + 12) !== 0xffff) put(u16(wb, d), u16(wb, d + 2), view.getFloat64(d + 6, true));
    else if (cur && type === 0x00fd && len >= 10) set(u16(wb, d), u16(wb, d + 2), sst[u32(wb, d + 6)] ?? '');
    else if (cur && type === 0x0204 && len >= 9) set(u16(wb, d), u16(wb, d + 2), labelText(wb, d + 6, d + len));
    p = d + len;
  }
  return sheets;
}

/** A short description of a workbook's sheets, for a check that could not read it: sizes and first rows. */
export function describeXls(data: ArrayBuffer | Uint8Array): string {
  const sheets = readXlsSheets(data);
  if (!sheets) return 'not an Excel 97 workbook';
  return sheets
    .map((rows, k) => {
      const filled = rows.filter((r) => r.some((c) => c !== ''));
      const first = filled.slice(0, 4).map((r) => r.slice(0, 5).join(' | ')).join(' / ');
      return `sheet ${k + 1}: ${filled.length} rows; ${first || 'no cells'}`;
    })
    .join('; ');
}
