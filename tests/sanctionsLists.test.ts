/**
 * Sanctions lists (utils/sanctionsLists.ts): hand-written rows in the published layouts (OFAC
 * legacy CSV, UN consolidated XML). Names are invented; no real list entry is reproduced.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addOfacCsv, addUnXml, countrySanctions, emptySanctionsData, iso3ForName, ofacPrograms, parseCsvRows, sanctionsSentence, searchSanctions } from '../src/utils/sanctionsLists.ts';

const SDN = [
  '1001,"EXAMPLE TRADING LLC","-0- ","IRAN] [SDGT","-0- ","-0- ","-0- ","-0- ","-0- ","-0- ","-0- ","Website example.test."',
  '1002,"DOE, John","individual","RUSSIA-EO14024","Director","-0- ","-0- ","-0- ","-0- ","-0- ","-0- ","DOB 01 Jan 1970; nationality Russia."',
  '1003,"SEA EXAMPLE","vessel","IRAN","-0- ","-0- ","Crude Oil Tanker","-0- ","-0- ","Panama","-0- ","-0- "',
  '\x1a',
].join('\r\n');
const ADD = [
  '1001,2001,"Tower 1","Dubai","United Arab Emirates","-0- "',
  '1001,2002,"Street 2","Tehran","Iran","-0- "',
  '1002,2003,"-0- ","Moscow","Russia","-0- "',
  '1003,2004,"-0- ","-0- ","Atlantis","-0- "',
].join('\r\n');

const UN = `<?xml version="1.0" encoding="UTF-8"?>
<CONSOLIDATED_LIST dateGenerated="2026-11-01T00:00:00.000-04:00">
<INDIVIDUALS>
<INDIVIDUAL><DATAID>1</DATAID><FIRST_NAME>JANE</FIRST_NAME><SECOND_NAME>EXAMPLE</SECOND_NAME><UN_LIST_TYPE>DPRK</UN_LIST_TYPE><REFERENCE_NUMBER>KPi.001</REFERENCE_NUMBER><LISTED_ON>2016-03-02</LISTED_ON>
<NATIONALITY><VALUE>Democratic People's Republic of Korea</VALUE></NATIONALITY><INDIVIDUAL_ADDRESS><COUNTRY>China</COUNTRY></INDIVIDUAL_ADDRESS></INDIVIDUAL>
</INDIVIDUALS>
<ENTITIES>
<ENTITY><DATAID>2</DATAID><FIRST_NAME>EXAMPLE BANK &amp; CO</FIRST_NAME><UN_LIST_TYPE>DPRK</UN_LIST_TYPE><REFERENCE_NUMBER>KPe.001</REFERENCE_NUMBER><LISTED_ON>2017-08-05</LISTED_ON>
<ENTITY_ADDRESS><COUNTRY>Democratic People's Republic of Korea</COUNTRY></ENTITY_ADDRESS></ENTITY>
</ENTITIES>
</CONSOLIDATED_LIST>`;

test('country names as the lists spell them', () => {
  assert.equal(iso3ForName('Korea, North'), 'PRK');
  assert.equal(iso3ForName("Democratic People's Republic of Korea"), 'PRK');
  assert.equal(iso3ForName('Iran (Islamic Republic of)'), 'IRN');
  assert.equal(iso3ForName('Türkiye'), 'TUR');
  assert.equal(iso3ForName("Cote d'Ivoire"), 'CIV');
  assert.equal(iso3ForName('Congo, Democratic Republic of the'), 'COD');
  assert.equal(iso3ForName('Atlantis'), null);
});

test('OFAC CSV: programmes, types, countries from addresses; unknown names reported', () => {
  assert.deepEqual(ofacPrograms('IRAN] [SDGT'), ['IRAN', 'SDGT']);
  assert.equal(parseCsvRows(SDN).length, 3);
  const d = emptySanctionsData();
  addOfacCsv(d, 'ofac_sdn', 'SDN.CSV', SDN, ADD, '2026-11-01');
  assert.equal(d.entries.length, 3);
  assert.deepEqual(d.entries[0], { list: 'ofac_sdn', id: '1001', name: 'EXAMPLE TRADING LLC', type: 'entity', programs: ['IRAN', 'SDGT'], countries: ['ARE', 'IRN'] });
  assert.equal(d.entries[1].type, 'individual');
  assert.equal(d.entries[2].type, 'vessel');
  assert.deepEqual(d.entries[2].countries, []);
  assert.deepEqual(d.unknownCountries, { Atlantis: 1 });
  assert.deepEqual(d.files, [{ list: 'ofac_sdn', file: 'SDN.CSV', entries: 3, modified: '2026-11-01' }]);
});

test('a file in another layout is skipped with the reason', () => {
  const d = emptySanctionsData();
  addOfacCsv(d, 'ofac_sdn', 'SDN.CSV', 'Name,Type\nX,Y', '');
  addUnXml(d, 'consolidated.xml', '<html></html>');
  assert.equal(d.entries.length, 0);
  assert.equal(d.skipped.length, 2);
});

test('UN XML: names, regime, nationality and address countries, date listed', () => {
  const d = emptySanctionsData();
  addUnXml(d, 'consolidated.xml', UN);
  assert.equal(d.entries.length, 2);
  assert.deepEqual(d.entries[0], { list: 'un', id: 'KPi.001', name: 'JANE EXAMPLE', type: 'individual', programs: ['DPRK'], countries: ['CHN', 'PRK'], listedOn: '2016-03-02' });
  assert.equal(d.entries[1].name, 'EXAMPLE BANK & CO');
  assert.equal(d.files[0].modified, '2026-11-01');
});

test('country view, sentence and plain-text search', () => {
  const d = emptySanctionsData();
  addOfacCsv(d, 'ofac_sdn', 'SDN.CSV', SDN, ADD);
  addUnXml(d, 'consolidated.xml', UN);
  const prk = countrySanctions(d, 'PRK');
  assert.equal(prk.total, 2);
  assert.deepEqual(prk.byList.map((l) => [l.list, l.entries]), [['ofac_sdn', 0], ['un', 2]]);
  assert.deepEqual(prk.programs, [{ list: 'un', program: 'DPRK', entries: 2 }]);
  assert.deepEqual(prk.unListedByYear, [{ year: '2016', entries: 1 }, { year: '2017', entries: 1 }]);
  assert.equal(sanctionsSentence('North Korea', prk, d), 'North Korea: 0 on the OFAC SDN list, 2 on the UN list with an address or nationality in the country; the largest programme is DPRK (UN, 2).');
  const irn = countrySanctions(d, 'IRN');
  assert.deepEqual(irn.byList[0].byType, { entity: 1 });
  assert.deepEqual(searchSanctions(d, 'john doe').map((e) => e.id), ['1002']);
  assert.deepEqual(searchSanctions(d, 'example').map((e) => e.id).sort(), ['1001', '1003', 'KPe.001', 'KPi.001']);
  assert.deepEqual(searchSanctions(d, ''), []);
  assert.equal(sanctionsSentence('X', countrySanctions(emptySanctionsData(), 'X'), emptySanctionsData()), 'X: no sanctions list files read.');
});

test('names as the 6 Nov 2026 files spell them: regions, inverted names, small states', () => {
  const by = (n: string) => iso3ForName(n);
  assert.equal(by('Region: Gaza'), 'PSE');
  assert.equal(by('Region: Northern Mali'), 'MLI');
  assert.equal(by('Man, Isle of'), 'IMN');
  assert.equal(by('North Macedonia, The Republic of'), 'MKD');
  assert.equal(by("Korea, Democratic People's Republic of"), 'PRK');
  assert.equal(by('Korea, Republic of'), 'KOR');
  assert.equal(by('China, Hong Kong Special Administrative Region'), 'HKG');
  assert.equal(by('Cote d Ivoire'), 'CIV');
  for (const [n, iso] of [['Barbados', 'BRB'], ['Dominica', 'DMA'], ['Palau', 'PLW'], ['Bermuda', 'BMU']]) assert.equal(by(n), iso);
  // Disputed areas and groupings stay unmatched (counted under "Country names not matched").
  for (const n of ['Region: Kashmir', 'Kafia Kingi', 'Commonwealth of Independent States', 'former Soviet Union']) assert.equal(by(n), null);
});
