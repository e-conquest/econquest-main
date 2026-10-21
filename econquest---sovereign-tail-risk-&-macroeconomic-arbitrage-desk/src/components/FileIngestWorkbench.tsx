import { SovereignEntity } from '../types/riskEngine';

interface FileIngestWorkbenchProps {
  sovereigns: SovereignEntity[];
  onUpdateSovereigns: (updated: SovereignEntity[]) => void;
  onNavigateToTab: (tab: string) => void;
}

export function FileIngestWorkbench(_props: FileIngestWorkbenchProps) {
  return (
    <section className="rounded border border-amber-700 p-5">
      <h2 className="text-lg">Imports moved to the research dashboard</h2>
      <p className="mt-3">Return to research and open File ingestion for validated, persistent CSV/Excel imports.
        Legacy guessed GPR/macro mappings have been retired. Sandbox scenarios never modify stored observations.</p>
    </section>
  );
}
