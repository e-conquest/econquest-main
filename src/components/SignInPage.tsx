import React, { useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { postAuth, type AuthStatus } from '../utils/authClient';

/**
 * The page shown instead of the app while sign-in applies and nobody is signed in: a sign-in form,
 * or, before any account exists, the form that creates the first admin account (with the one-time
 * setup code from the server log when the app is open to a network). See src/utils/auth.ts.
 */

export const FIELD_CLASS =
  'w-full px-2 py-1.5 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white';

function Field(props: { id: string; label: string; type?: string; value: string; onChange: (v: string) => void; autoComplete?: string; hint?: string }) {
  return (
    <label htmlFor={props.id} className="block space-y-1">
      <span className="ui-label">{props.label}</span>
      <input
        id={props.id}
        name={props.id}
        type={props.type || 'text'}
        value={props.value}
        autoComplete={props.autoComplete}
        onChange={(e) => props.onChange(e.target.value)}
        className={FIELD_CLASS}
        required
      />
      {props.hint && <span className="block text-xs text-slate-500 dark:text-slate-400">{props.hint}</span>}
    </label>
  );
}

/** Creates the first admin account. Used here and in Menu > Account while sign-in is off. */
export function FirstAccountForm({ needsCode, onDone }: { needsCode: boolean; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== again) return setError('The two passwords differ.');
    setBusy(true);
    setError('');
    const r = await postAuth('/api/auth/setup', { code, username, displayName, password });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Create the first admin account">
      {needsCode && (
        <Field
          id="setup-code"
          label="Setup code"
          value={code}
          onChange={setCode}
          autoComplete="one-time-code"
          hint="Printed in the server log when the app started (docker logs econquest-orchestrator, or the terminal running it)."
        />
      )}
      <Field id="setup-username" label="Username" value={username} onChange={setUsername} autoComplete="username" />
      <Field id="setup-name" label="Name shown on sign-offs and in the audit log" value={displayName} onChange={setDisplayName} autoComplete="name" />
      <Field id="setup-password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint="At least 12 characters. A short sentence works well." />
      <Field id="setup-again" label="Password again" type="password" value={again} onChange={setAgain} autoComplete="new-password" />
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
      <button type="submit" disabled={busy} className="ui-btn ui-btn-primary w-full justify-center">
        {busy ? 'Creating…' : 'Create admin account and sign in'}
      </button>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        From then on everyone signs in, including on this computer. A forgotten password can be reset on the server with
        <code className="mx-1">npm run users -- reset-password &lt;username&gt;</code>.
      </p>
    </form>
  );
}

function SignInForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await postAuth('/api/auth/sign-in', { username, password });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Sign in">
      <Field id="signin-username" label="Username" value={username} onChange={setUsername} autoComplete="username" />
      <Field id="signin-password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
      <button type="submit" disabled={busy} className="ui-btn ui-btn-primary w-full justify-center">
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

export function SignInPage({ status }: { status: AuthStatus }) {
  const reload = () => window.location.reload();
  const setup = status.mode === 'setup';
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <h1 className="ui-title inline-flex items-center gap-2">
          {setup ? <ShieldCheck className="w-4 h-4" aria-hidden /> : <KeyRound className="w-4 h-4" aria-hidden />}
          {setup ? 'Create the first admin account' : 'Sign in to EconQuest'}
        </h1>
        {setup && (
          <p className="ui-body">
            This app is open to a network and has no accounts yet. The first account is the admin, who manages keys, settings and
            other accounts.
          </p>
        )}
        {setup ? <FirstAccountForm needsCode={status.setupNeedsCode} onDone={reload} /> : <SignInForm onDone={reload} />}
        {!setup && <p className="text-xs text-slate-500 dark:text-slate-400">Signed out after {status.sessionIdleHours} hours without use. Ask your admin for an account.</p>}
      </div>
    </main>
  );
}
