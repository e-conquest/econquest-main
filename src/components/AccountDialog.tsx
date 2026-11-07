import React, { useEffect, useRef, useState } from 'react';
import { UserRound, X } from 'lucide-react';
import { fetchAuthStatus, postAuth, type AuthStatus } from '../utils/authClient';
import { ROLE_LABEL } from '../utils/authLabels';
import { FIELD_CLASS, FirstAccountForm } from './SignInPage';

/**
 * Menu > Account: who is signed in, sign out and change password. While sign-in is off (no accounts,
 * app on this computer only) it says so and offers to create the first admin account.
 */
export function AccountDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<AuthStatus | null | undefined>(undefined);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void fetchAuthStatus().then(setStatus);
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const signOut = async () => {
    await postAuth('/api/auth/sign-out', {});
    window.location.reload();
  };
  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) return setMessage({ ok: false, text: 'The two new passwords differ.' });
    const r = await postAuth<{ endedSessions: number }>('/api/auth/password', { current, next });
    if (!r.ok) return setMessage({ ok: false, text: r.error });
    setCurrent('');
    setNext('');
    setAgain('');
    const n = r.data.endedSessions;
    setMessage({ ok: true, text: `Password changed.${n ? ` Signed out ${n} other session${n === 1 ? '' : 's'}.` : ''}` });
  };

  const account = status?.account;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="account-title" className="w-full max-w-md max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 id="account-title" className="ui-title inline-flex items-center gap-2">
            <UserRound className="w-4 h-4" aria-hidden /> Account
          </h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close account" className="ui-btn ui-btn-ghost">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-4 overflow-y-auto ui-body">
          {status === undefined && <p>Loading…</p>}
          {status === null && <p>The app server did not answer.</p>}
          {status && status.mode === 'off' && (
            <>
              <p>
                Sign-in is off. The app answers on this computer only and has no accounts, so whoever uses this computer can use
                everything in it.
              </p>
              {status.canCreateFirstAccount ? (
                <>
                  <p>To share it with other people, create the admin account first. After that everyone signs in.</p>
                  <FirstAccountForm needsCode={false} onDone={() => window.location.reload()} />
                </>
              ) : (
                <p>The first account can only be created from the computer running the app.</p>
              )}
            </>
          )}
          {account && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="ui-label">Name</dt>
                <dd>{account.displayName}</dd>
                <dt className="ui-label">Username</dt>
                <dd>{account.username}</dd>
                <dt className="ui-label">Role</dt>
                <dd>{ROLE_LABEL[account.role]}</dd>
              </dl>
              <button type="button" onClick={signOut} className="ui-btn">
                Sign out
              </button>
              <form onSubmit={changePassword} className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-3" aria-label="Change password">
                <h3 className="ui-label">Change password</h3>
                <input aria-label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" className={FIELD_CLASS} required />
                <input aria-label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (12+ characters)" className={FIELD_CLASS} required />
                <input aria-label="New password again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} placeholder="New password again" className={FIELD_CLASS} required />
                {message && (
                  <p role="status" className={message.ok ? 'text-sm text-emerald-700 dark:text-emerald-400' : 'text-sm text-rose-700 dark:text-rose-400'}>
                    {message.text}
                  </p>
                )}
                <button type="submit" className="ui-btn ui-btn-primary">
                  Change password
                </button>
                <p className="text-xs text-slate-500 dark:text-slate-400">Changing it signs you out on every other browser.</p>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
