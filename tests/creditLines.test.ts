import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditLine, creditsFor, framedSvg, publicationCheck, publicationFooter, shareModeBlock, wrapText } from '../src/utils/creditLines.ts';
import { licenceRow } from '../src/utils/licenceLookup.ts';

test('credit lines come from the register, placeholders filled from the source, examples dropped', () => {
  assert.equal(creditLine(licenceRow('worldbank')!, 'World Bank WDI'), 'The World Bank: World Bank WDI.');
  assert.equal(creditLine(licenceRow('bis')!, 'BIS central bank policy rates'), 'Source: BIS (Bank for International Settlements), BIS central bank policy rates.');
  assert.equal(creditLine(licenceRow('kalshi')!, 'Kalshi'), `Source: ${licenceRow('kalshi')!.name}.`);
  assert.doesNotMatch(creditLine(licenceRow('imf')!, 'IMF World Economic Outlook'), /</);
});

test('credits follow each source register row, once each, filled from the first source that names it', () => {
  const c = creditsFor(['CFTC, week to 2026-10-28', 'CFTC, week to 2026-10-21', 'GDELT tone']);
  assert.equal(c.credits.length, 2);
  assert.match(c.credits[0], /CFTC/);
  assert.doesNotMatch(c.credits.join(' '), /2026-10-21/);
  assert.match(c.credits[1], /GDELT/);
  assert.deepEqual(c.notShareable, []);
  assert.doesNotMatch(creditsFor(['IMF WEO, 2025']).credits[0], /</);
});

test("the app's own calculations carry no credit and are not held back", () => {
  assert.deepEqual(creditsFor(['HP filter on the series above']), { credits: [], notShareable: [] });
});

test('sharing mode blocks an export only when a source cannot be passed on', () => {
  assert.equal(shareModeBlock(['FRED'], false), null);
  assert.equal(shareModeBlock(['World Bank, 2024', 'IMF WEO', 'BIS'], true), null);
  assert.match(shareModeBlock(['World Bank, 2024', 'FRED'], true) ?? '', /^Sharing mode is on and this uses FRED/);
});

test('Publish chart: restricted sources block; unclear and unmapped are named; open sources pass', () => {
  const open = publicationCheck(['World Bank WDI']);
  assert.equal(open.blocked.length, 0);
  assert.equal(open.credits.length, 1);
  assert.deepEqual(publicationCheck(['Kalshi market']).blocked.map((b) => b.id), ['kalshi']);
  const oecd = publicationCheck(['OECD via DBnomics']);
  assert.equal(oecd.blocked.length, 0);
  assert.deepEqual(oecd.unclear.map((u) => u.id), ['oecd']);
  assert.deepEqual(publicationCheck(['my spreadsheet']).unmapped, ['my spreadsheet']);
  assert.equal(publicationCheck(['World Bank WDI', 'World Bank WGI']).credits.length, 1);
  // A BIS policy rate for Turkey, "(CBRT)" in its source, is not read as the EVDS feed.
  assert.equal(publicationCheck(['BIS central bank policy rates (CBRT)']).credits.length, 1);
});

test('wrapText keeps lines within the width', () => {
  assert.deepEqual(wrapText('one two three four five six seven', 10), ['one two', 'three four', 'five six', 'seven']);
});

test('one framed SVG for both exports: title, subtitle, chart and footer, escaped, no currentColor', () => {
  const svg = framedSvg('<svg width="600" height="300"><path stroke="currentColor"/></svg>', 600, 300, { title: 'Brazil & Mexico', subtitle: 'Monthly', footer: ['Sources: CFTC <weekly>', '', 'Credit: Source: CFTC.'] });
  assert.match(svg, /^<svg xmlns/);
  assert.match(svg, /Brazil &amp; Mexico/);
  assert.match(svg, />Monthly</);
  assert.match(svg, /<svg x="0" y="\d+" width="600"/);
  assert.match(svg, /CFTC &lt;weekly&gt;/);
  assert.match(svg, /Credit: Source: CFTC\./);
  assert.doesNotMatch(svg, /currentColor/);
  assert.equal((svg.match(/<text /g) || []).length, 4, 'empty footer lines are dropped');
  const foot = publicationFooter({ source: 'Source: IMF WEO', period: '2000 to 2025', asOf: '2026-11-06', credit: 'Source: International Monetary Fund, IMF WEO.' });
  assert.deepEqual(foot, ['Source: IMF WEO', 'Period: 2000 to 2025. As of 2026-11-06.', 'Credit: International Monetary Fund, IMF WEO.']);
});
