import { MetricsBar } from '../components/MetricsBar';
import { PipelineMonitor } from '../components/PipelineMonitor';
import { ReviewQueue } from '../components/ReviewQueue';
import { AnalyticsPanel } from '../components/AnalyticsPanel';
import { ActivityLog } from '../components/ActivityLog';
import { SettingsPanel } from '../components/SettingsPanel';

export default function Dashboard(): JSX.Element {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Dropship Admin</h1>
            <p className="text-sm text-gray-500">Pipeline metrics and review queue</p>
          </div>
          <a
            className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50"
            href="/admin/queues"
            target="_blank"
            rel="noreferrer"
          >
            Open Bull Board
          </a>
        </div>

        <MetricsBar />
        <PipelineMonitor />
        <ReviewQueue />
        <AnalyticsPanel />
        <ActivityLog />
        <SettingsPanel />
      </div>
    </div>
  );
}