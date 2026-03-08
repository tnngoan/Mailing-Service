'use client';

import { useEffect, useState } from 'react';

interface Campaign {
  id: number;
  subject: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
}

interface Props {
  campaigns: Campaign[];
  activeCampaignId: number | null;
  onUpdate: (campaigns: Campaign[]) => void;
}

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  sending: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  completed: 'bg-green-500/20 text-green-400 border-green-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
};

export default function CampaignStatus({ campaigns, activeCampaignId, onUpdate }: Props) {
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (!activeCampaignId) return;

    const active = campaigns.find((c) => c.id === activeCampaignId);
    if (active && (active.status === 'completed' || active.status === 'failed')) {
      setPolling(false);
      return;
    }

    setPolling(true);
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/campaigns');
        if (res.ok) {
          const updated: Campaign[] = await res.json();
          onUpdate(updated);
          const current = updated.find((c) => c.id === activeCampaignId);
          if (current && (current.status === 'completed' || current.status === 'failed')) {
            setPolling(false);
            clearInterval(interval);
          }
        }
      } catch {}
    }, 2000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCampaignId]);

  if (campaigns.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
        Recent Campaigns {polling && <span className="text-blue-400 normal-case">(live)</span>}
      </h2>
      <div className="space-y-2">
        {campaigns.map((c) => {
          const pct = c.totalRecipients > 0
            ? Math.round((c.sentCount / c.totalRecipients) * 100)
            : 0;

          return (
            <div
              key={c.id}
              className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-zinc-100 truncate">{c.subject}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {new Date(c.createdAt).toLocaleString()}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full border ${STATUS_COLORS[c.status] ?? 'bg-zinc-700 text-zinc-300'}`}
                >
                  {c.status}
                </span>
              </div>

              {c.totalRecipients > 0 && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-zinc-400">
                    <span>{c.sentCount.toLocaleString()} sent</span>
                    <span>
                      {c.failedCount > 0 && (
                        <span className="text-red-400 mr-2">{c.failedCount} failed</span>
                      )}
                      {c.totalRecipients.toLocaleString()} total
                    </span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
