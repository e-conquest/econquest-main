import { CDS_HIDDEN } from '../utils/cdsHidden';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Bell, CheckCircle2, Sunrise, Cpu, ExternalLink, Eye, EyeOff, KeyRound, Lock, Settings2, X, XCircle, Wrench } from 'lucide-react';
import type { AIRuntimeConfig } from '../types/council';
import { AiModelSettings } from './AiModelSettings';
import { BackupSettings } from './BackupSettings';
import { MorningBriefSettings } from './MorningBriefSettings';
import { STATE_LABEL, isFailure, type ConnectionResult } from '../utils/connectionCheck';
import type { ApiKeyStatus } from '../utils/userSettings';

/**
 * Settings (Menu > Settings, or Cmd/Ctrl + comma). The "Data API keys" section lets you paste your
 * own key for a data source instead of editing .env. Keys are saved by the app server on this
 * computer only (data/local/settings.json), win over .env, and come back to the browser masked.
 * Each key can be tested before it is saved; the test is the same as the Data connections check.
 */

/**
 * Any part of the app can open Settings with openSettings('ai') (or the raw event, whose detail
 * may name the page: { tab: 'ai' | 'keys' | 'paid' | 'alerts' | 'morning' | 'backup' | 'tools' }).
 */
export const OPEN_SETTINGS_EVENT = 'econquest:open-settings';

export function openSettings(tab?: SettingsTab): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: tab ? { tab } : undefined }));
}

interface KeysReply {
  keys: ApiKeyStatus[];
  canEdit: boolean;
  savedIn: string;
  requestFrom?: string;
  inDocker?: boolean;
  encryption?: { atRest: boolean; keyFrom: string | null; problem: string | null; unreadable: string[] };
  /** Server alerts: the last alert the server tried to send. */
  lastAlert?: { at: string; title: string; results: Array<{ route: 'webhook' | 'email'; ok: boolean; detail: string }> } | null;
}

type KeySection = ApiKeyStatus['section'];

const SECTIONS: Array<{ id: KeySection; title: string; note: string }> = [
  { id: 'free_key', title: 'Free sources that take your own key', note: 'Free to register. Each one is optional unless it says otherwise.' },
  {
    id: 'own_account',
    title: 'Your own paid data (off unless you switch it on)',
    note: 'Licensed to you, not built into the app. Figures from here are labelled with whose data they are, so check your licence before sending them on.',
  },
  {
    id: 'ai',
    title: 'AI model key',
    note: 'Which model the council uses (Gemini, Ollama, a local server) and the Ollama address are chosen under AI model.',
  },
  {
    id: 'alerts',
    title: 'Where alerts go',
    note: 'A webhook, email, or both. Messages say what failed and when, never a key or password. Test sends a real test message.',
  },
];

const SOURCE_LABEL: Record<ApiKeyStatus['source'], string> = {
  app: 'Saved in Settings',
  env: 'From .env',
  none: 'Not set',
};

function CheckLine({ check }: { check: ConnectionResult }) {
  const ok = check.state === 'connected';
  const bad = isFailure(check.state) || check.state === 'needs_setup';
  const tone = ok ? 'text-emerald-700 dark:text-emerald-400' : bad ? 'text-rose-700 dark:text-rose-400' : 'text-slate-600 dark:text-slate-400';
  return (
    <div className={`mt-2 flex items-start gap-1.5 text-xs ${tone}`} role="status" data-key-check={check.state}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden /> : bad ? <XCircle className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden /> : null}
      <span>
        <span className="font-medium">{check.id.startsWith('alert_') ? (ok ? 'Sent' : 'Not sent') : STATE_LABEL[check.state]}:</span> {ok && check.sample ? check.sample : check.detail}
      </span>
    </div>
  );
}

const KeyRow: React.FC<{ k: ApiKeyStatus; canEdit: boolean; onChanged: (r: KeysReply) => void }> = ({ k, canEdit, onChanged }) => {
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<'' | 'test' | 'save' | 'remove'>('');
  const [error, setError] = useState('');
  const [check, setCheck] = useState<ConnectionResult | null>(null);
  const inputId = `settings-key-${k.id}`;
  // A pick-one setting shows its current choice (Off when nothing is set).
  const current = k.choices ? k.masked || 'off' : '';

  const call = async (kind: 'test' | 'save' | 'remove') => {
    setBusy(kind);
    setError('');
    setCheck(null);
    try {
      const url = kind === 'test' ? `/api/settings/keys/${k.id}/test` : `/api/settings/keys/${k.id}`;
      const method = kind === 'test' ? 'POST' : kind === 'save' ? 'PUT' : 'DELETE';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: kind === 'remove' ? undefined : JSON.stringify({ value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `The app server answered HTTP ${res.status}.`);
      if (body.check) setCheck(body.check);
      if (kind !== 'test') {
        onChanged(body as KeysReply);
        setValue('');
        setShow(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <li className="py-4" data-settings-key={k.id} data-source={k.source}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label htmlFor={inputId} className="font-medium text-sm text-slate-900 dark:text-white">
          {k.label}
        </label>
        <span className={k.source === 'none' ? 'ui-badge' : 'ui-badge ui-badge-positive'}>
          {SOURCE_LABEL[k.source]}
          {k.masked ? ` ${k.choices?.find((c) => c.value === k.masked)?.label || k.masked}` : ''}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
        {k.section === 'own_account' ? '' : `${k.provider}. `}
        {k.feeds} {k.withoutIt}
      </p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {k.getKeySteps}{' '}
        <a href={k.getKeyUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-blue-700 dark:text-blue-400 hover:underline">
          {k.section === 'alerts' ? 'How to set it up' : k.secret ? 'How to get a key' : 'Where to find it'} <ExternalLink className="w-3 h-3" aria-hidden />
        </a>
      </p>
      {k.source === 'app' && k.envAlsoSet && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">.env also has a key. The one saved here is used; remove it here to go back to .env.</p>
      )}

      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() && canEdit && !busy) call('save');
        }}
      >
        {k.choices ? (
          <select
            id={inputId}
            value={value || current}
            onChange={(e) => setValue(e.target.value === current ? '' : e.target.value)}
            disabled={!canEdit}
            className="flex-1 min-w-[14rem] px-2 py-1.5 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white disabled:opacity-60"
          >
            {k.choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="relative flex-1 min-w-[14rem]">
            <input
              id={inputId}
              type={show || !k.secret ? 'text' : 'password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={!canEdit ? 'Locked (see the note above)' : k.placeholder && k.source === 'none' ? k.placeholder : !k.secret ? (k.source === 'none' ? 'Type it here' : 'Type a new value to replace it') : k.source === 'none' ? 'Paste your key' : 'Paste a new key to replace it'}
              autoComplete="off"
              spellCheck={false}
              disabled={!canEdit}
              className="w-full px-2 py-1.5 pr-8 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white disabled:opacity-60"
            />
            {k.secret && (<button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? 'Hide key' : 'Show key'}
              title={show ? 'Hide key' : 'Show key'}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>)}
          </div>
        )}
        <button type="button" className="ui-btn" disabled={!canEdit || !!busy || (!value.trim() && k.source === 'none' && !k.choices)} onClick={() => call('test')}>
          {busy === 'test' ? 'Testing…' : value.trim() ? 'Test' : k.choices ? 'Test current setting' : k.secret && k.section !== 'alerts' ? 'Test current key' : 'Test current setting'}
        </button>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={!canEdit || !!busy || !value.trim()}>
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        {k.source === 'app' && (
          <button type="button" className="ui-btn ui-btn-danger" disabled={!canEdit || !!busy} onClick={() => call('remove')}>
            {busy === 'remove' ? 'Removing…' : 'Remove'}
          </button>
        )}
      </form>
      {error && (
        <div className="mt-2 text-xs text-rose-700 dark:text-rose-400" role="alert">
          {error}
        </div>
      )}
      {check && <CheckLine check={check} />}
    </li>
  );
};

export type SettingsTab = 'ai' | 'keys' | 'paid' | 'alerts' | 'morning' | 'backup' | 'tools';

/** The pages of Settings, in order, and which key sections each one shows. */
const PAGES: Array<{ id: SettingsTab; label: string; sections: KeySection[] }> = [
  { id: 'ai', label: 'AI model', sections: [] },
  { id: 'keys', label: 'Free data keys', sections: ['free_key'] },
  // Holds only the own-data CDS switch, hidden for now (src/utils/cdsHidden.ts).
  ...(CDS_HIDDEN ? [] : [{ id: 'paid' as const, label: 'Your own paid data', sections: ['own_account' as const] }]),
  { id: 'alerts', label: 'Server alerts', sections: ['alerts'] },
  { id: 'morning', label: 'Morning brief', sections: [] },
  { id: 'backup', label: 'Backup', sections: [] },
  { id: 'tools', label: 'Tools', sections: [] },
];
const PAGE_ICON: Record<SettingsTab, React.ReactNode> = {
  ai: <Cpu className="w-3.5 h-3.5" aria-hidden />,
  keys: <KeyRound className="w-3.5 h-3.5" aria-hidden />,
  paid: <Lock className="w-3.5 h-3.5" aria-hidden />,
  alerts: <Bell className="w-3.5 h-3.5" aria-hidden />,
  morning: <Sunrise className="w-3.5 h-3.5" aria-hidden />,
  backup: <Archive className="w-3.5 h-3.5" aria-hidden />,
  tools: <Wrench className="w-3.5 h-3.5" aria-hidden />,
};

export const SettingsDialog: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** Opens the full (advanced) AI set-up window. */
  onOpenAiModel?: () => void;
  /** Which page is showing (Sam, 2026-11-05: one Settings window, each link opens its page). */
  tab?: SettingsTab;
  onTabChange?: (tab: SettingsTab) => void;
  /** The Tools page, drawn when the Tools part is open. */
  tools?: React.ReactNode;
  /** The AI model choice (Menu > Settings > AI model), for the AI model page. */
  aiConfig?: AIRuntimeConfig;
  onAiConfigChange?: (next: AIRuntimeConfig) => void;
}> = ({ isOpen, onClose, onOpenAiModel, tab = 'ai', onTabChange, tools, aiConfig, onAiConfigChange }) => {
  const showTools = tab === 'tools' && !!tools;
  const showAi = tab === 'ai' && !!aiConfig && !!onAiConfigChange;
  const page = PAGES.find((p) => p.id === tab) || PAGES[1];
  const [reply, setReply] = useState<KeysReply | null>(null);
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/settings/keys');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReply((await res.json()) as KeysReply);
    } catch (e) {
      setError(`The app server did not answer (${e instanceof Error ? e.message : String(e)}).`);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    load();
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, load, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className={`w-full ${showTools ? 'max-w-6xl' : 'max-w-3xl'} max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 id="settings-title" className="ui-title inline-flex items-center gap-2">
            <Settings2 className="w-4 h-4" aria-hidden /> Settings
          </h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close settings" className="ui-btn ui-btn-ghost">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col sm:flex-row min-h-0 flex-1">
          <nav aria-label="Settings sections" className="sm:w-48 shrink-0 border-b sm:border-b-0 sm:border-r border-slate-200 dark:border-slate-800 p-2 flex sm:flex-col gap-1 overflow-x-auto">
            {PAGES.filter((p) => (p.id === 'tools' ? !!tools : p.id === 'ai' ? !!aiConfig : true)).map((p) => (
              <button
                key={p.id}
                type="button"
                aria-current={tab === p.id ? 'page' : undefined}
                aria-pressed={tab === p.id}
                className="ui-tab inline-flex items-center gap-2 text-left whitespace-nowrap"
                onClick={() => onTabChange?.(p.id)}
                data-settings-tab={p.id}
                {...(p.id === 'tools' ? { 'data-settings-tools-tab': 'true' } : {})}
              >
                {PAGE_ICON[p.id]} {p.label}
              </button>
            ))}
          </nav>

          {showTools ? (
            <section className="flex-1 min-w-0 overflow-y-auto px-4 py-3" aria-label="Tools" data-settings-tools="true">
              {tools}
            </section>
          ) : tab === 'morning' ? (
            <section className="flex-1 min-w-0 overflow-y-auto px-4 py-3" aria-labelledby="settings-morning-title">
              <h3 id="settings-morning-title" className="ui-section-title">Morning brief</h3>
              <div className="mt-3">
                <MorningBriefSettings />
              </div>
            </section>
          ) : tab === 'backup' ? (
            <section className="flex-1 min-w-0 overflow-y-auto px-4 py-3" aria-labelledby="settings-backup-title">
              <h3 id="settings-backup-title" className="ui-section-title">Backup</h3>
              <div className="mt-3">
                <BackupSettings />
              </div>
            </section>
          ) : showAi ? (
            <section className="flex-1 min-w-0 overflow-y-auto px-4 py-3" aria-labelledby="settings-ai-title">
              <h3 id="settings-ai-title" className="ui-section-title">AI model</h3>
              <div className="mt-3">
                <AiModelSettings
                  config={aiConfig!}
                  onChange={onAiConfigChange!}
                  geminiKeySet={reply ? reply.keys.some((k) => k.section === 'ai' && k.source !== 'none') : undefined}
                  geminiKey={
                    reply ? (
                      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        {reply.keys
                          .filter((k) => k.section === 'ai')
                          .map((k) => (
                            <KeyRow key={k.id} k={k} canEdit={reply.canEdit} onChanged={setReply} />
                          ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500">{error || 'Loading…'}</p>
                    )
                  }
                  onOpenAdvanced={
                    onOpenAiModel
                      ? () => {
                          onClose();
                          onOpenAiModel();
                        }
                      : undefined
                  }
                />
              </div>
            </section>
          ) : (
          <section className="flex-1 min-w-0 overflow-y-auto px-4 py-3" aria-labelledby="settings-keys-title">
            <h3 id="settings-keys-title" className="ui-section-title">{page.label}</h3>
            {page.id === 'alerts' && (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400" data-alerts-intro>
                For a server left running: a short message when the nightly data check finds a source that broke, a scheduled job fails, or a backtest that passed now fails. Nothing is sent until a
                webhook or email is set here (or in .env). See docs/HOME_SERVER.md, Server alerts.
              </p>
            )}
            {page.id === 'alerts' && reply && (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400" data-last-alert>
                {reply.lastAlert
                  ? `Last alert ${reply.lastAlert.at.slice(0, 16).replace('T', ' ')} UTC, "${reply.lastAlert.title}": ${reply.lastAlert.results.map((r) => `${r.route} ${r.ok ? 'sent' : `not sent (${r.detail})`}`).join('; ')}.`
                  : 'No alert sent yet.'}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Your own keys and settings{page.id === 'alerts' ? '' : ' for data sources'}. They are saved on this computer only{reply ? ` (${reply.savedIn})` : ''}, sent only to the source they belong to, and shown here masked. A key
              saved here is used instead of the same key in .env.
            </p>
            {reply?.encryption && (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400" data-key-encryption>
                {reply.encryption.atRest
                  ? `Saved keys are encrypted on disk (AES-256-GCM), with a master key from ${reply.encryption.keyFrom} that is kept outside the data folder.`
                  : 'Saved keys are not encrypted on disk (plain text in a file only this app can read). To encrypt them, set ECONQUEST_SECRET_KEY or a Docker secret; see docs/SECURITY.md.'}
                {reply.encryption.problem ? ` ${reply.encryption.problem}` : ''}
                {reply.encryption.unreadable.length
                  ? ` ${reply.encryption.unreadable.length} saved key(s) cannot be opened with the current master key and are not in use; save them again.`
                  : ''}
              </p>
            )}
            {reply && !reply.canEdit && (
              <p className="mt-2 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900" role="note">
                The key boxes are locked because this page reached the app from {reply.requestFrom || 'another address'}, not from this computer (127.0.0.1).{' '}
                {reply.inDocker
                  ? 'The app is running in Docker: pull the latest version and rebuild (docker compose up -d --build), which publishes the app on this computer only and unlocks Settings.'
                  : 'Open the app at http://localhost on the computer running it, or set SETTINGS_ALLOW_REMOTE="true" in .env if you trust every device on your network.'}
              </p>
            )}
            {error && (
              <p className="mt-2 text-xs text-rose-700 dark:text-rose-400" role="alert">
                {error}
              </p>
            )}
            {!reply && !error && <p className="mt-3 text-sm text-slate-500">Loading…</p>}
            {reply &&
              SECTIONS.filter((sec) => page.sections.includes(sec.id)).map((sec) => {
                const keys = reply.keys.filter((k) => (k.section || 'free_key') === sec.id);
                if (!keys.length) return null;
                return (
                  <div key={sec.id} id={`settings-section-${sec.id}`} className="mt-4">
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{sec.title}</h4>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sec.note}</p>
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {keys.map((k) => (
                        <KeyRow key={k.id} k={k} canEdit={reply.canEdit} onChanged={setReply} />
                      ))}
                    </ul>
                  </div>
                );
              })}
          </section>
          )}
        </div>
      </div>
    </div>
  );
};
