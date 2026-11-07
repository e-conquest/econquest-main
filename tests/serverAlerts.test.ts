import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertSettingsFrom, alertsOn, alertText, scrubSecrets, sendAlert, senderOf, webhookRequest, type ServerAlert } from '../src/utils/serverAlerts';
import { alertSecrets, testAlertRoute } from '../src/server/alerts';
import { apiKeyField } from '../src/data/apiKeyFields';

const NOW = new Date('2026-11-06T02:41:00Z');
const ALERT: ServerAlert = { kind: 'scheduled_job', title: 'Download all failed', lines: ['Stopped early: FRED answered 403 for ?api_key=abcdef0123456789abcdef0123456789'] };

test('nothing is on until a webhook or a mail server plus an address is set', () => {
  assert.equal(alertsOn(alertSettingsFrom({})), false);
  assert.equal(alertsOn(alertSettingsFrom({ ALERT_EMAIL_TO: 'a@b.co' })), false);
  assert.equal(alertsOn(alertSettingsFrom({ ALERT_SMTP_URL: 'smtps://u:p@h:465', ALERT_EMAIL_TO: 'a@b.co' })), true);
  assert.equal(alertsOn(alertSettingsFrom({ ALERT_WEBHOOK_URL: ' https://x.example/hook ' })), true);
});

test('scrubSecrets blanks saved values, smtp credentials and keys in web addresses', () => {
  const out = scrubSecrets('key SECRETVALUE123 then smtps://me%40x.com:pw@smtp.x.com:465 and https://a.b/?token=zzz9', ['SECRETVALUE123', 'ab']);
  assert.ok(!out.includes('SECRETVALUE123'));
  assert.ok(!out.includes('pw@'));
  assert.ok(out.includes('smtp.x.com'));
  assert.ok(!out.includes('zzz9'));
  // Short values are not blanked, so ordinary words survive.
  assert.ok(scrubSecrets('about', ['ab']).includes('about'));
});

test('alert text never carries a saved key, the webhook address or the mail password', () => {
  const env = {
    FRED_API_KEY: 'abcdef0123456789abcdef0123456789',
    ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/T000/B000/XXXXSECRET',
    ALERT_SMTP_URL: 'smtps://me%40x.com:hunter22pass@smtp.x.com:465',
    ALERT_EMAIL_TO: 'me@x.com',
  };
  const a: ServerAlert = { kind: 'test', title: 'x', lines: [`FRED ${env.FRED_API_KEY}`, `posted to ${env.ALERT_WEBHOOK_URL}`, 'login hunter22pass failed'] };
  const t = alertText(a, NOW, alertSecrets(env));
  const all = t.subject + t.body;
  for (const v of ['abcdef0123456789', 'XXXXSECRET', 'hunter22pass']) assert.ok(!all.includes(v), v);
  // The email address is not a secret: it stays readable.
  assert.deepEqual(alertSecrets(env).includes('me@x.com'), false);
  assert.match(t.body, /2026-11-06 02:41 UTC/);
});

test('webhook body fits the receiver', () => {
  const t = { subject: 'econquest: x', body: '- one\n\nFrom h' };
  assert.deepEqual(Object.keys(JSON.parse(webhookRequest('https://discord.com/api/webhooks/1/abc', ALERT, t, NOW).body)), ['content']);
  assert.deepEqual(Object.keys(JSON.parse(webhookRequest('https://hooks.slack.com/services/a', ALERT, t, NOW).body)), ['text']);
  assert.deepEqual(Object.keys(JSON.parse(webhookRequest('https://chat.googleapis.com/v1/spaces/a', ALERT, t, NOW).body)), ['text']);
  const ntfy = webhookRequest('https://ntfy.sh/mytopic', ALERT, t, NOW);
  assert.equal(ntfy.body, t.body);
  assert.equal(ntfy.headers.Title, 'econquest: x');
  const own = JSON.parse(webhookRequest('http://192.168.1.5:9000/in', ALERT, t, NOW).body);
  assert.equal(own.kind, 'scheduled_job');
  assert.deepEqual(own.lines, ['one']);
});

test('sendAlert posts to the webhook and reports HTTP errors without the address', async () => {
  const seen: Array<{ url: string; body: string }> = [];
  const ok = await sendAlert(ALERT, { webhookUrl: 'https://hooks.slack.com/services/T/B/SECRETPART' }, {
    now: NOW,
    fetchFn: (async (url: string, init: any) => {
      seen.push({ url, body: init.body });
      return new Response('ok', { status: 200 });
    }) as any,
  });
  assert.deepEqual(ok, [{ route: 'webhook', ok: true, detail: 'Sent (HTTP 200).' }]);
  assert.ok(!seen[0].body.includes('abcdef0123456789'));
  const bad = await sendAlert(ALERT, { webhookUrl: 'https://hooks.slack.com/services/T/B/SECRETPART' }, { fetchFn: (async () => new Response('no', { status: 404 })) as any });
  assert.equal(bad[0].ok, false);
  assert.match(bad[0].detail, /HTTP 404/);
  const down = await sendAlert(ALERT, { webhookUrl: 'https://hooks.slack.com/services/T/B/SECRETPART' }, { fetchFn: (async () => { throw new Error('connect ECONNREFUSED https://hooks.slack.com/services/T/B/SECRETPART'); }) as any });
  assert.equal(down[0].ok, false);
  assert.ok(!down[0].detail.includes('SECRETPART'));
});

test('email: sender from the smtp user name, clear reasons when something is missing, password never in errors', async () => {
  assert.equal(senderOf({ smtpUrl: 'smtps://me%40x.com:pw@smtp.x.com:465' }), 'me@x.com');
  assert.equal(senderOf({ smtpUrl: 'smtps://apikey:pw@smtp.sendgrid.net:465' }), null);
  assert.equal(senderOf({ smtpUrl: 'smtps://apikey:pw@smtp.sendgrid.net:465', emailFrom: 'a@b.co' }), 'a@b.co');

  const missing = await sendAlert(ALERT, { emailTo: 'a@b.co' });
  assert.match(missing[0].detail, /ALERT_SMTP_URL/);
  const noFrom = await sendAlert(ALERT, { smtpUrl: 'smtps://apikey:pw@smtp.sendgrid.net:465', emailTo: 'a@b.co' });
  assert.match(noFrom[0].detail, /ALERT_EMAIL_FROM/);

  const mails: any[] = [];
  const sent = await sendAlert(ALERT, { smtpUrl: 'smtps://me%40x.com:hunter22pass@smtp.x.com:465', emailTo: 'a@b.co' }, { now: NOW, sendMail: async (_u, m) => void mails.push(m) });
  assert.deepEqual(sent, [{ route: 'email', ok: true, detail: 'Sent to a@b.co.' }]);
  assert.equal(mails[0].from, 'me@x.com');
  assert.equal(mails[0].subject, 'econquest: Download all failed');
  assert.ok(!mails[0].text.includes('abcdef0123456789'));

  const refused = await sendAlert(ALERT, { smtpUrl: 'smtps://me%40x.com:hunter22pass@smtp.x.com:465', emailTo: 'a@b.co' }, { sendMail: async () => { throw new Error('Invalid login for hunter22pass'); } });
  assert.equal(refused[0].ok, false);
  assert.ok(!refused[0].detail.includes('hunter22pass'));
});

test('Test button: sends on the one route, with the typed value in place of the saved one', async () => {
  const field = apiKeyField('ALERT_WEBHOOK_URL')!;
  const urls: string[] = [];
  const fetchFn = (async (url: string) => (urls.push(url), new Response(null, { status: 204 }))) as any;
  const r = await testAlertRoute(field, 'https://hooks.slack.com/services/typed', { ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/saved', ALERT_EMAIL_TO: 'a@b.co' }, { fetchFn });
  assert.equal(r.state, 'connected');
  assert.deepEqual(urls, ['https://hooks.slack.com/services/typed']);
  const none = await testAlertRoute(field, '', {});
  assert.equal(none.state, 'needs_setup');

  const mailField = apiKeyField('ALERT_EMAIL_TO')!;
  const mails: any[] = [];
  const m = await testAlertRoute(mailField, 'b@c.co', { ALERT_SMTP_URL: 'smtps://me%40x.com:pw@smtp.x.com:465', ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/x' }, { fetchFn, sendMail: async (_u, mail) => void mails.push(mail) });
  assert.equal(m.state, 'connected');
  assert.equal(mails[0].to, 'b@c.co');
  assert.equal(urls.length, 1, 'the email test does not post to the webhook');
});

test('settings validate the alert fields', () => {
  assert.equal(apiKeyField('ALERT_WEBHOOK_URL')!.validate('https://hooks.slack.com/x'), null);
  assert.ok(apiKeyField('ALERT_WEBHOOK_URL')!.validate('hooks.slack.com/x'));
  assert.equal(apiKeyField('ALERT_SMTP_URL')!.validate('smtps://u%40x.com:p@smtp.x.com:465'), null);
  assert.ok(apiKeyField('ALERT_SMTP_URL')!.validate('https://smtp.x.com'));
  assert.equal(apiKeyField('ALERT_EMAIL_TO')!.validate('a@b.co, c@d.org'), null);
  assert.ok(apiKeyField('ALERT_EMAIL_TO')!.validate('nope'));
  assert.equal(apiKeyField('ALERT_EMAIL_TO')!.secret, false);
  assert.notEqual(apiKeyField('ALERT_SMTP_URL')!.secret, false);
});
