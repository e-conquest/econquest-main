/**
 * Server alerts, the server side (src/utils/serverAlerts.ts does the sending, src/utils/alertEvents.ts
 * says which events alert): notify() for the server's jobs, and the Test button in
 * Menu > Settings > Server alerts. Settings come from process.env, where keys saved in Settings
 * are applied over .env (src/utils/userSettings.ts), so a value in either place works.
 */
import fs from 'fs';
import path from 'path';
import { API_KEY_FIELDS, type ApiKeyField } from '../data/apiKeyFields';
import type { ConnectionResult } from '../utils/connectionCheck';
import { alertSettingsFrom, alertsOn, secretsIn, sendAlert, TEST_ALERT, type AlertSettings, type DeliveryResult, type SendDeps, type ServerAlert } from '../utils/serverAlerts';

/** Settings that are secret (keys, the webhook address, the mail server with its password). */
const SECRET_IDS = API_KEY_FIELDS.filter((f) => f.secret !== false).map((f) => f.id);

/** Every secret value in this environment, to blank in any message. */
export const alertSecrets = (env: Record<string, string | undefined>) => secretsIn(env, SECRET_IDS, alertSettingsFrom(env));

/**
 * The Test button for a Server alerts setting: sends a real test message on that route (the
 * webhook, or email with the three email settings), with the typed value in place of the saved
 * one. Answers in the shape of a connection check row so Settings shows it like any other test.
 */
export async function testAlertRoute(field: ApiKeyField, value: string, env: Record<string, string | undefined>, deps: SendDeps = {}): Promise<ConnectionResult> {
  const withValue = value ? { ...env, [field.id]: value } : env;
  const all = alertSettingsFrom(withValue);
  const webhook = field.id === 'ALERT_WEBHOOK_URL';
  const route: AlertSettings = webhook ? { webhookUrl: all.webhookUrl } : { smtpUrl: all.smtpUrl, emailTo: all.emailTo, emailFrom: all.emailFrom };
  const base = { id: field.checkId, name: field.label, group: 'free' as const, feeds: field.feeds, host: '' };
  if (webhook ? !route.webhookUrl : !route.smtpUrl && !route.emailTo) {
    return { ...base, state: 'needs_setup', detail: webhook ? 'Type a webhook address first.' : 'Set the mail server and the address to send to first.' };
  }
  const [r] = await sendAlert(TEST_ALERT, route, { ...deps, secrets: alertSecrets(withValue) });
  if (!r) return { ...base, state: 'needs_setup', detail: 'Nothing to send to.' };
  return r.ok ? { ...base, state: 'connected', detail: r.detail, } : { ...base, state: /could not be reached|did not answer/.test(r.detail) ? 'no_answer' : r.detail.startsWith('Not sent') ? 'needs_setup' : 'refused', detail: r.detail };
}

/** The last alert the server tried to send, kept so Settings can say whether it went out. */
export interface LastAlert {
  at: string;
  kind: ServerAlert['kind'];
  title: string;
  results: DeliveryResult[];
}

export function readLastAlert(file: string): LastAlert | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v.at === 'string' && Array.isArray(v.results) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Sends an alert on every route that is set, logs how each went and keeps it as the last alert.
 * Does nothing when no route is set; never throws, so a broken webhook cannot stop a job.
 */
export async function notify(alert: ServerAlert, file: string, env: Record<string, string | undefined> = process.env, deps: SendDeps = {}): Promise<DeliveryResult[]> {
  const settings = alertSettingsFrom(env);
  if (!alertsOn(settings)) return [];
  try {
    const now = deps.now || new Date();
    const results = await sendAlert(alert, settings, { ...deps, now, secrets: alertSecrets(env) });
    for (const r of results) console.log(`[alert] ${alert.title}: ${r.route} ${r.ok ? 'sent' : 'not sent'}. ${r.detail}`);
    const last: LastAlert = { at: now.toISOString(), kind: alert.kind, title: alert.title, results };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(last, null, 2));
    fs.renameSync(`${file}.tmp`, file);
    return results;
  } catch (e: any) {
    console.error('[alert]', e?.message || e);
    return [];
  }
}
