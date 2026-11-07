/**
 * Server alerts (Sam, 2026-11-06: "alerts from the home server"): a short message to a webhook
 * (Slack, Discord, Google Chat, ntfy, your own receiver) and/or an email when something on an
 * unattended server goes wrong. Set in Menu > Settings > Server alerts, or in .env:
 *
 *   ALERT_WEBHOOK_URL   where to POST the message
 *   ALERT_SMTP_URL      smtp(s)://user:password@host:port, the mail server that sends the email
 *   ALERT_EMAIL_TO      who gets it (one address, or several separated by commas)
 *   ALERT_EMAIL_FROM    the sender (default: the user name in ALERT_SMTP_URL)
 *
 * Nothing is sent unless one of the two routes is set. A message never carries a key: every text
 * goes through scrubSecrets(), which blanks the value of every saved key and setting and anything
 * that looks like a key in a web address, before it leaves this computer.
 */
import os from 'os';
import { redact } from './dataHealth';

export interface ServerAlert {
  /** What kind of trouble, for a receiver that sorts messages. */
  kind: 'test' | 'data_check' | 'scheduled_job' | 'backtest_regression';
  /** One line: "Download all failed". The app name is added in front. */
  title: string;
  /** What happened, one point per line. */
  lines: string[];
}

export interface AlertSettings {
  webhookUrl?: string;
  smtpUrl?: string;
  emailTo?: string;
  emailFrom?: string;
}

export const ALERT_ENV = {
  webhookUrl: 'ALERT_WEBHOOK_URL',
  smtpUrl: 'ALERT_SMTP_URL',
  emailTo: 'ALERT_EMAIL_TO',
  emailFrom: 'ALERT_EMAIL_FROM',
} as const;

export function alertSettingsFrom(env: Record<string, string | undefined>): AlertSettings {
  const get = (k: string) => (env[k] || '').trim() || undefined;
  return { webhookUrl: get(ALERT_ENV.webhookUrl), smtpUrl: get(ALERT_ENV.smtpUrl), emailTo: get(ALERT_ENV.emailTo), emailFrom: get(ALERT_ENV.emailFrom) };
}

export const webhookOn = (s: AlertSettings) => Boolean(s.webhookUrl);
export const emailOn = (s: AlertSettings) => Boolean(s.smtpUrl && s.emailTo);
export const alertsOn = (s: AlertSettings) => webhookOn(s) || emailOn(s);

/**
 * Blanks every secret value (saved keys, the webhook address, the mail password) found in a text,
 * then anything that looks like a key in a web address. Values shorter than 6 characters are left,
 * so a short setting ("on", a year) does not blank ordinary words.
 */
export function scrubSecrets(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  const values = [...new Set(secrets.map((s) => (s || '').trim()).filter((s) => s.length >= 6))].sort((a, b) => b.length - a.length);
  for (const v of values) out = out.split(v).join('…');
  // A mail server address with a password in it: keep the host, drop the user and password.
  out = out.replace(/\b(smtps?:\/\/)[^@\s/]+@/gi, '$1…@');
  return redact(out) ?? out;
}

/** Every secret the app holds right now: saved key values plus the alert routes themselves. */
export function secretsIn(env: Record<string, string | undefined>, keyIds: string[], s: AlertSettings): string[] {
  const out = keyIds.map((id) => env[id]).filter((v): v is string => Boolean(v));
  if (s.webhookUrl) out.push(s.webhookUrl);
  if (s.smtpUrl) {
    out.push(s.smtpUrl);
    try {
      const u = new URL(s.smtpUrl);
      if (u.password) out.push(decodeURIComponent(u.password));
    } catch {
      // not a URL: validated in Settings
    }
  }
  return out;
}

const host = () => {
  try {
    return os.hostname();
  } catch {
    return 'the server';
  }
};

/** The message as plain text: a title line, the points, and where it came from. */
export function alertText(a: ServerAlert, now: Date, secrets: Array<string | undefined>): { subject: string; body: string } {
  const subject = scrubSecrets(`econquest: ${a.title}`, secrets).slice(0, 200);
  const points = a.lines.map((l) => `- ${scrubSecrets(l, secrets).slice(0, 500)}`);
  const footer = `From ${host()} at ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC. Details in Menu > Data health.`;
  return { subject, body: [...points, '', footer].join('\n').slice(0, 1900) };
}

/**
 * The webhook body, shaped for the receiver the address points at. Slack, Google Chat and
 * Mattermost read `text`; Discord reads `content`; ntfy takes plain text. Anything else gets one
 * JSON object with both the text and the parts, for your own receiver.
 */
export function webhookRequest(url: string, a: ServerAlert, text: { subject: string; body: string }, now: Date): { headers: Record<string, string>; body: string } {
  let hostName = '';
  try {
    hostName = new URL(url).hostname.toLowerCase();
  } catch {
    hostName = '';
  }
  const full = `${text.subject}\n${text.body}`;
  if (/(^|\.)discord(app)?\.com$/.test(hostName)) return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: full.slice(0, 2000) }) };
  if (hostName === 'hooks.slack.com' || hostName === 'chat.googleapis.com') return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: full }) };
  if (hostName === 'ntfy.sh') return { headers: { 'Content-Type': 'text/plain; charset=utf-8', Title: text.subject.replace(/[^\x20-\x7e]/g, '') }, body: text.body };
  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: full, title: text.subject, lines: text.body.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)), kind: a.kind, at: now.toISOString(), source: 'econquest' }),
  };
}

export interface DeliveryResult {
  route: 'webhook' | 'email';
  ok: boolean;
  /** One sentence, already scrubbed: "Sent (HTTP 200)." or why not. */
  detail: string;
}

export interface SendDeps {
  fetchFn?: typeof fetch;
  /** Sends one email; defaults to nodemailer with ALERT_SMTP_URL. */
  sendMail?: (smtpUrl: string, mail: { from: string; to: string; subject: string; text: string }) => Promise<void>;
  now?: Date;
  /** Values to blank in every message and every error (saved keys); the routes are added. */
  secrets?: string[];
}

async function nodemailerSend(smtpUrl: string, mail: { from: string; to: string; subject: string; text: string }): Promise<void> {
  // Loaded only when an email is sent, so a copy without `npm install` still starts.
  let nodemailer: typeof import('nodemailer');
  try {
    nodemailer = (await import('nodemailer')).default as any;
  } catch {
    throw new Error('the nodemailer package is not installed; run npm install');
  }
  const transport = nodemailer.createTransport(smtpUrl, { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 } as any);
  try {
    await transport.sendMail(mail);
  } finally {
    transport.close();
  }
}

/** The sender address: ALERT_EMAIL_FROM, else the user name in the mail server address when it is an address. */
export function senderOf(s: AlertSettings): string | null {
  if (s.emailFrom) return s.emailFrom;
  try {
    const user = decodeURIComponent(new URL(s.smtpUrl || '').username);
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user) ? user : null;
  } catch {
    return null;
  }
}

/** Sends to every route that is set. Never throws: each route says how it went. */
export async function sendAlert(a: ServerAlert, s: AlertSettings, deps: SendDeps = {}): Promise<DeliveryResult[]> {
  const now = deps.now || new Date();
  const secrets = [...(deps.secrets || []), ...secretsIn({}, [], s)];
  const text = alertText(a, now, secrets);
  const clean = (m: string) => scrubSecrets(m, secrets).slice(0, 300);
  const out: DeliveryResult[] = [];

  if (s.webhookUrl) {
    try {
      const req = webhookRequest(s.webhookUrl, a, text, now);
      const res = await (deps.fetchFn || fetch)(s.webhookUrl, { method: 'POST', headers: req.headers, body: req.body, signal: AbortSignal.timeout(10_000) });
      out.push(res.ok ? { route: 'webhook', ok: true, detail: `Sent (HTTP ${res.status}).` } : { route: 'webhook', ok: false, detail: `The webhook answered HTTP ${res.status}${res.statusText ? ` ${clean(res.statusText)}` : ''}.` });
    } catch (e: any) {
      const why = e?.name === 'TimeoutError' ? 'no answer in 10 seconds' : clean(e?.cause?.code || e?.message || String(e));
      out.push({ route: 'webhook', ok: false, detail: `The webhook could not be reached (${why}).` });
    }
  }

  if (s.smtpUrl || s.emailTo) {
    const from = senderOf(s);
    if (!s.smtpUrl) out.push({ route: 'email', ok: false, detail: 'Not sent: the mail server (ALERT_SMTP_URL) is not set.' });
    else if (!s.emailTo) out.push({ route: 'email', ok: false, detail: 'Not sent: no address to send to (ALERT_EMAIL_TO).' });
    else if (!from) out.push({ route: 'email', ok: false, detail: 'Not sent: no sender address. Set ALERT_EMAIL_FROM, or use an email address as the user name in ALERT_SMTP_URL.' });
    else {
      try {
        await (deps.sendMail || nodemailerSend)(s.smtpUrl, { from, to: s.emailTo, subject: text.subject, text: text.body });
        out.push({ route: 'email', ok: true, detail: `Sent to ${s.emailTo}.` });
      } catch (e: any) {
        out.push({ route: 'email', ok: false, detail: `The mail server refused or did not answer (${clean(e?.response || e?.code || e?.message || String(e))}).` });
      }
    }
  }
  return out;
}

export const TEST_ALERT: ServerAlert = {
  kind: 'test',
  title: 'test alert',
  lines: ['This is a test from Menu > Settings > Server alerts. Real alerts look like this: what failed, and when.'],
};
