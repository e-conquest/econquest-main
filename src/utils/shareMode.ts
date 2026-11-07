/**
 * Sharing mode: one switch (Menu > Sharing mode) for when what you download is going to someone
 * else, such as a public note or a chart in an open-source write-up. The project is free research
 * with no paid use, so the question is only whether a source's terms let its figures be passed on
 * for free (the `share` field of the licence register, src/data/dataLicences.ts).
 *
 * With it on, every table download (figures, series, Compare countries, As of; CSV and Excel) holds
 * back each value whose source is marked "Do not pass on" or "Sharing unclear". The row stays, with
 * its source, so the reader sees what was held back and why; the value reads "Withheld". Figures the
 * app works out itself without naming an outside source pass. Off, downloads are as before. The
 * switch is saved in data/local/workspace.json so the server applies it too.
 *
 * Browser-safe.
 */
import { LICENCE_SHARE_LABEL } from '../data/dataLicences';
import { shareForSource } from './licenceLookup';

export const SHARE_MODE_KEY = 'econquest.shareMode.v1';

export function shareModeFromValue(value: string | null | undefined): boolean {
  return value === '1';
}

export function loadShareMode(): boolean {
  try {
    return shareModeFromValue(localStorage.getItem(SHARE_MODE_KEY));
  } catch {
    return false;
  }
}

export function saveShareMode(on: boolean): void {
  try {
    localStorage.setItem(SHARE_MODE_KEY, on ? '1' : '0');
  } catch {
    // blocked storage: the switch is not remembered in this browser
  }
}

/** Why a value from this source is held back in sharing mode, or null when it can be passed on. */
export function withheldReason(source: string | undefined): string | null {
  const share = shareForSource(source);
  if (!share || share.share === 'allowed') return null;
  const names = share.rows.filter((r) => r.share === share.share).map((r) => r.name).join('; ');
  return `Withheld in sharing mode: ${LICENCE_SHARE_LABEL[share.share].toLowerCase()} (${names}; Menu > About & data licences)`;
}

type Cell = string | number | null | undefined;

/**
 * Rows of a download table with sharing mode applied. Works on any table with `value` and `source`
 * columns. Tables with a `status` column read "Withheld" there and give the reason in
 * `reason_if_missing`; tables without one get "Withheld" in the value cell itself.
 */
export function withholdForSharing(header: string[], rows: Cell[][]): Cell[][] {
  const v = header.indexOf('value');
  const src = header.indexOf('source');
  if (v < 0 || src < 0) return rows;
  const status = header.indexOf('status');
  const reason = header.indexOf('reason_if_missing');
  return rows.map((row) => {
    const value = row[v];
    if (value === null || value === undefined || value === '') return row;
    const why = withheldReason(String(row[src] ?? ''));
    if (!why) return row;
    const out = [...row];
    if (status >= 0) {
      out[v] = null;
      out[status] = 'Withheld';
      if (reason >= 0) out[reason] = why;
    } else {
      out[v] = 'Withheld';
    }
    return out;
  });
}
