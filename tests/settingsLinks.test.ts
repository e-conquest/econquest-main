import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSettingsLinks } from '../src/utils/settingsLinks.ts';

test('settings paths in help text become links to their page', () => {
  assert.deepEqual(splitSettingsLinks('Connect your CDS under Menu > Settings > Your own paid data (a CSV file).'), [
    'Connect your CDS under ',
    { text: 'Menu > Settings > Your own paid data', page: 'paid' },
    ' (a CSV file).',
  ]);
  assert.deepEqual(splitSettingsLinks('Add a key (Menu > Settings, or EIA_API_KEY).'), ['Add a key (', { text: 'Menu > Settings', page: 'keys' }, ', or EIA_API_KEY).']);
  assert.deepEqual(splitSettingsLinks('Open Settings > AI model to fix it.'), ['Open ', { text: 'Settings > AI model', page: 'ai' }, ' to fix it.']);
  assert.deepEqual(splitSettingsLinks('Check Menu > AI model and data connections.'), ['Check ', { text: 'Menu > AI model and data connections', page: 'ai' }, '.']);
  assert.deepEqual(splitSettingsLinks('Menu > Settings > Data API keys'), [{ text: 'Menu > Settings > Data API keys', page: 'keys' }]);
});

test('an ordinary word "Settings" stays text', () => {
  assert.deepEqual(splitSettingsLinks('Settings were saved.'), ['Settings were saved.']);
  assert.deepEqual(splitSettingsLinks('No link here.'), ['No link here.']);
});
