import { lazy, Suspense, useState } from 'react';
import { ResearchDashboard } from './components/ResearchDashboard';

const ExperimentalApp = lazy(() => import('./ExperimentalApp'));

export default function App() {
  const [experimental, setExperimental] = useState(false);
  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-700 p-3">
        <strong>{experimental ? 'EXPERIMENTAL SANDBOX — illustrative, not observed monitoring' : 'EconQuest Research & Monitoring'}</strong>
        <button className="rounded border border-slate-500 px-3 py-2" onClick={() => setExperimental(!experimental)}>
          {experimental ? 'Return to research dashboard' : 'Open experimental sandbox'}
        </button>
      </div>
      {experimental && (
        <Suspense fallback={<p className="p-6">Loading experimental sandbox…</p>}>
          <ExperimentalApp />
        </Suspense>
      )}
      <div hidden={experimental}><ResearchDashboard /></div>
    </div>
  );
}
