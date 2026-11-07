import React, { useEffect, useRef, useState } from 'react';
import { Users, X } from 'lucide-react';
import type { PublicAccount, Role } from '../utils/auth';
import { ROLE_LABEL } from '../utils/authLabels';
import { ROLE_CAN } from '../utils/permissions';
import { FIELD_CLASS } from './SignInPage';

type Row = PublicAccount & { sessions: number };
const ROLES: Role[] = ['viewer', 'analyst', 'admin'];

async function call(method: string, path: string, body?: unknown): Promise<{ accounts?: Row[]; password?: string; error?: string }> {
  try {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? data : { error: data?.error || `The server answered ${res.status}.` };
  } catch {
    return { error: 'The app server did not answer.' };
  }
}

/**
 * Menu > Users (admins only): every account with its role, add an account, change a role, disable,
 * or reset a password. A new or reset password is shown once, to pass on to the person.
 */
export function UsersDialog({ me, onClose }: { me: PublicAccount; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [secret, setSecret] = useState<{ username: string; password: string } | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('analyst');
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const apply = (r: { accounts?: Row[]; error?: string }) => {
    if (r.error) setError(r.error);
    else setError('');
    if (r.accounts) setRows(r.accounts);
  };
  useEffect(() => {
    void call('GET', '/api/users').then(apply);
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await call('POST', '/api/users', { username, displayName, role });
    apply(r);
    if (!r.error && r.password) {
      setSecret({ username: username.trim().toLowerCase(), password: r.password });
      setUsername('');
      setDisplayName('');
    }
  };
  const change = async (row: Row, patch: { role?: Role; disabled?: boolean }) => apply(await call('PUT', `/api/users/${encodeURIComponent(row.id)}`, patch));
  const reset = async (row: Row) => {
    const r = await call('POST', `/api/users/${encodeURIComponent(row.id)}/reset-password`);
    apply(r);
    if (!r.error && r.password) setSecret({ username: row.username, password: r.password });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="users-title" className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 id="users-title" className="ui-title inline-flex items-center gap-2">
            <Users className="w-4 h-4" aria-hidden /> Users
          </h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close users" className="ui-btn ui-btn-ghost">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-4 overflow-y-auto ui-body">
          <ul className="text-sm space-y-0.5">
            {ROLES.map((r) => (
              <li key={r}>
                <span className="font-medium">{ROLE_LABEL[r]}:</span> {ROLE_CAN[r]}
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
          {secret && (
            <div role="status" className="border border-amber-300 dark:border-amber-700 p-2 text-sm">
              Password for <strong>{secret.username}</strong>, shown once: <code className="select-all">{secret.password}</code>. Pass it on privately; they
              can change it under Menu &gt; Account.{' '}
              <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setSecret(null)}>
                Done
              </button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left ui-label">
                  <th className="py-1 pr-2">Name</th>
                  <th className="py-1 pr-2">Username</th>
                  <th className="py-1 pr-2">Role</th>
                  <th className="py-1 pr-2">Signed in</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`border-t border-slate-100 dark:border-slate-800 ${r.disabled ? 'opacity-60' : ''}`}>
                    <td className="py-1.5 pr-2">{r.displayName}{r.id === me.id ? ' (you)' : ''}</td>
                    <td className="py-1.5 pr-2">{r.username}</td>
                    <td className="py-1.5 pr-2">
                      <select aria-label={`Role of ${r.username}`} value={r.role} onChange={(e) => change(r, { role: e.target.value as Role })} className={FIELD_CLASS + ' w-auto'}>
                        {ROLES.map((x) => (
                          <option key={x} value={x}>
                            {ROLE_LABEL[x]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 pr-2">{r.disabled ? 'Disabled' : r.sessions ? `${r.sessions} browser${r.sessions === 1 ? '' : 's'}` : 'No'}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <button type="button" className="ui-btn ui-btn-ghost" onClick={() => reset(r)}>
                        Reset password
                      </button>
                      {r.id !== me.id && (
                        <button type="button" className="ui-btn ui-btn-ghost" onClick={() => change(r, { disabled: !r.disabled })}>
                          {r.disabled ? 'Enable' : 'Disable'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form onSubmit={add} className="border-t border-slate-200 dark:border-slate-800 pt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] items-end" aria-label="Add an account">
            <label className="space-y-1">
              <span className="ui-label">Username</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} className={FIELD_CLASS} autoComplete="off" required />
            </label>
            <label className="space-y-1">
              <span className="ui-label">Name shown</span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={FIELD_CLASS} autoComplete="off" required />
            </label>
            <label className="space-y-1">
              <span className="ui-label">Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={FIELD_CLASS}>
                {ROLES.map((x) => (
                  <option key={x} value={x}>
                    {ROLE_LABEL[x]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="ui-btn ui-btn-primary">
              Add account
            </button>
          </form>
          <p className="text-xs text-slate-500 dark:text-slate-400">Every change here is in the audit log with your name.</p>
        </div>
      </div>
    </div>
  );
}
