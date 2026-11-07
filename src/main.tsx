import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { WatchlistWindow } from './components/WatchlistWindow';
import { PanelBoundary } from './components/PanelBoundary';
import './index.css';
import { forgetOtherAccount, mirrorSavesToDisk, startWorkspaceSync } from './utils/workspaceSync';
import { fetchAuthStatus, needsSignIn, watchForSignedOut } from './utils/authClient';
import { SignInPage } from './components/SignInPage';

// /?view=watchlist is the watchlist popped out into its own window or tab.
const popOut = new URLSearchParams(window.location.search).get('view') === 'watchlist';

// Holdings, watchlists, added countries and AI settings live in data/local/workspace.json, so the
// app shows the same ones at any address (Docker or npm run dev). Load them before the first draw.
const draw = () =>
  createRoot(document.getElementById('root')!).render(
    <PanelBoundary page name={popOut ? 'The watchlist' : 'The app'}>{popOut ? <WatchlistWindow /> : <App />}</PanelBoundary>
  );

function start(accountId: string | null) {
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null; // storage blocked: the app runs for this session only
  }
  if (storage && accountId) forgetOtherAccount(storage, accountId);
  if (storage) {
    const target = storage;
    void startWorkspaceSync({ storage: target, fetchFn: window.fetch.bind(window) }).finally(() => {
      mirrorSavesToDisk(Storage.prototype, target, window.fetch.bind(window));
      draw();
    });
  } else {
    draw();
  }
}

// Sign-in (src/utils/auth.ts): while it applies and nobody is signed in, show only the sign-in page.
// With sign-in off (no accounts, this computer only) the app starts exactly as before.
void fetchAuthStatus().then((status) => {
  if (status && needsSignIn(status)) {
    createRoot(document.getElementById('root')!).render(<SignInPage status={status} />);
    return;
  }
  if (status && status.mode !== 'off') watchForSignedOut(window, status.csrfToken);
  start(status?.account?.id ?? null);
});
