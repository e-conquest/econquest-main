import { DataFeedConfig } from '../types/riskEngine';
import { DEFAULT_DATA_FEEDS } from '../data/defaultDataFeeds';

interface DataFeedSettingsProps {
  feeds: DataFeedConfig[];
  onUpdateFeed: (feed: DataFeedConfig) => void;
  onAddFeed: (feed: DataFeedConfig) => void;
  onDeleteFeed: (feedId: string) => void;
  onResetDefaults: () => void;
  onImportFeeds: (feeds: DataFeedConfig[]) => void;
}

export function DataFeedSettings(_props: DataFeedSettingsProps) {
  return (
    <section className="space-y-4 rounded border border-slate-700 p-5">
      <h2 className="text-xl">Provider catalog - not connection status</h2>
      <p>Endpoint configuration is not proof of connectivity or ingestion.
        No connection tests or latency values are simulated. Use the research dashboard for manual Yahoo ETF pulls and durable file ingestion.</p>
      {DEFAULT_DATA_FEEDS.map(feed => (
        <div key={feed.id} className="rounded border border-slate-700 p-3">
          <h3>{feed.name} - catalog entry</h3>
          <p className="text-sm text-slate-400">{feed.primarySourceDoc}</p>
        </div>
      ))}
    </section>
  );
}
