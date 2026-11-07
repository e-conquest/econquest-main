import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acledLagMonths, acledReadUrl, acledRising, acledTokenBody, acledNextCursor, parseAcledPage, summariseAcled, acledCountryName, ACLED_NO_ACCOUNT } from '../src/utils/acled.ts';
import { acledFigures, politicsFromSnapshot } from '../src/utils/politicsEvents.ts';
import { checkConnections, type FetchFn } from '../src/utils/connectionCheck.ts';
import { buildBaselineOpenData } from '../src/data/presetsAndBaselines.ts';

const NOW = new Date('2026-11-06T12:00:00Z');

// Rows in the shape ACLED's read endpoint returns (fields=event_date|event_type|fatalities).
function rows(): Array<{ event_date: string; event_type: string; fatalities: number }> {
  const out: Array<{ event_date: string; event_type: string; fatalities: number }> = [];
  for (let m = 0; m < 12; m++) {
    const ym = m < 2 ? `2025-${m === 0 ? '11' : '12'}` : `2026-${String(m - 1).padStart(2, '0')}`;
    const n = m >= 9 ? 30 : 10; // last three months (Aug-Oct 2026) busier
    for (let i = 0; i < n; i++) out.push({ event_date: `${ym}-1${i % 9}`, event_type: i % 2 ? 'Protests' : 'Battles', fatalities: i % 2 ? 0 : 1 });
  }
  out.push({ event_date: '2026-11-02', event_type: 'Riots', fatalities: 0 }); // current month, not complete
  return out;
}

test('read URL: country, three-year window, cursor paging, no credentials in it', () => {
  const u = new URL(acledReadUrl('Mexico', NOW));
  assert.equal(u.origin + u.pathname, 'https://acleddata.com/api/acled/read');
  assert.equal(u.searchParams.get('country'), 'Mexico');
  assert.equal(u.searchParams.get('event_date'), '2023-11-01|2026-11-06');
  assert.equal(u.searchParams.get('event_date_where'), 'BETWEEN');
  assert.equal(u.searchParams.get('cursor'), '0');
  assert.equal(new URL(acledReadUrl('Mexico', NOW, 'abc')).searchParams.get('cursor'), 'abc');
  const body = acledTokenBody(' me@uni.edu ', 'p@ss');
  assert.equal(body.get('username'), 'me@uni.edu');
  assert.equal(body.get('grant_type'), 'password');
  assert.equal(body.get('client_id'), 'acled');
  assert.equal(acledCountryName('EGY', 'Egypt (Red Sea Corridor)'), 'Egypt');
});

test('page parsing and next cursor', () => {
  assert.deepEqual(parseAcledPage({ status: 200, data: [{ event_date: '2026-10-01', event_type: 'Riots', fatalities: '2' }, { event_date: 'x' }] }), [{ event_date: '2026-10-01', event_type: 'Riots', fatalities: 2 }]);
  assert.equal(parseAcledPage({ status: 403, data: [] }), null);
  assert.equal(parseAcledPage('<html>'), null);
  assert.equal(acledNextCursor({ next_cursor: 'c2' }), 'c2');
  assert.equal(acledNextCursor({ next_cursor: null }), null);
});

test('twelve whole months, current month left out, rising rule stated', () => {
  const r = summariseAcled(rows(), 'Mexico', NOW.toISOString(), NOW)!;
  assert.equal(r.months.length, 12);
  assert.equal(r.total.from, '2025-11');
  assert.equal(r.total.to, '2026-10');
  assert.equal(r.total.events, 9 * 10 + 3 * 30);
  assert.equal(r.recentAvg, 30);
  assert.equal(r.priorAvg, 10);
  assert.ok(acledRising(r));
  assert.equal(acledLagMonths(r, NOW), 0);
  const f = acledFigures(r, NOW);
  assert.match(f.figures[0].label, /Nov 2025 to Oct 2026/);
  assert.match(f.figures[0].source, /ACLED \(Armed Conflict Location & Event Data\), accessed 2026-11-06, country = Mexico/);
  assert.equal(f.figures.find((x) => x.label === 'Conflict reading')?.tag, 'model');
  assert.equal(summariseAcled([], 'Mexico', NOW.toISOString(), NOW), null);
});

test('a lagged account: the window is what came back, and the lag is said', () => {
  const old = rows().map((x) => ({ ...x, event_date: `${Number(x.event_date.slice(0, 4)) - 1}${x.event_date.slice(4)}` }));
  const r = summariseAcled(old, 'Mexico', NOW.toISOString(), NOW)!;
  assert.equal(r.total.to, '2025-11');
  assert.match(acledFigures(r, NOW).figures[0].source, /access lags about 12 months/);
});

test('politics: ACLED reading carried; a missing reason rides along only with other figures', () => {
  const base = buildBaselineOpenData('MEX');
  const r = summariseAcled(rows(), 'Mexico', NOW.toISOString(), NOW)!;
  assert.equal(politicsFromSnapshot({ ...base, liveFields: {}, acled: r })?.acledEvents?.total.events, 180);
  assert.equal(politicsFromSnapshot({ ...base, liveFields: {}, gdeltRaw: undefined, acledMissing: ACLED_NO_ACCOUNT }), undefined);
});

test('connection row: not set up, wrong password, Open account without API, connected; password never in the report', async () => {
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const make = (readStatus: number): FetchFn => async (u, init) => {
    if (u === 'https://acleddata.com/oauth/token') {
      const b = new URLSearchParams(String(init?.body || ''));
      return b.get('password') === 'right-pass' ? json({ token_type: 'Bearer', expires_in: 86400, access_token: 'TOKEN-XYZ' }) : json({ error: 'invalid_grant' }, 400);
    }
    if (u.startsWith('https://acleddata.com/api/acled/read')) {
      if (new Headers(init?.headers).get('Authorization') !== 'Bearer TOKEN-XYZ') return json({}, 401);
      return readStatus === 200 ? json({ status: 200, data: [{ event_date: '2026-10-30', event_type: 'Protests', fatalities: 0 }], next_cursor: null }) : json({ status: readStatus, error: 'forbidden' }, readStatus);
    }
    throw new TypeError('fetch failed');
  };
  const row = async (env: Record<string, string>, read = 200) => (await checkConnections({ env, fetchFn: make(read), now: NOW, only: ['acled'] })).results[0];
  assert.match((await row({})).detail, /Not set up/);
  assert.match((await row({ ACLED_EMAIL: 'me@uni.edu' })).detail, /password is empty/);
  const bad = await row({ ACLED_EMAIL: 'me@uni.edu', ACLED_PASSWORD: 'wrong-pass' });
  assert.equal(bad.state, 'needs_setup');
  assert.match(bad.detail, /did not accept the email and password/);
  const open = await row({ ACLED_EMAIL: 'me@gmail.com', ACLED_PASSWORD: 'right-pass' }, 403);
  assert.equal(open.state, 'needs_setup');
  assert.match(open.detail, /Open accounts/);
  const ok = await row({ ACLED_EMAIL: 'me@uni.edu', ACLED_PASSWORD: 'right-pass' });
  assert.equal(ok.state, 'connected');
  assert.match(ok.sample || '', /newest 2026-10-30/);
  for (const r of [bad, open, ok]) assert.doesNotMatch(JSON.stringify(r), /right-pass|wrong-pass|TOKEN-XYZ/);
});
