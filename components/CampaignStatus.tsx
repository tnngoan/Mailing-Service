'use client';

import { useEffect, useState, useCallback } from 'react';

interface Campaign {
  id: number;
  subject: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  errorMessage?: string | null;
  createdAt: string;
}

interface ProviderReport {
  provider: string;
  sent: number;
  failed: number;
  errors: string[];
}

interface CampaignDetail extends Campaign {
  pendingCount: number;
  dailyLimit: number;
  daysRemaining: number;
  batchHistory: { day: number; sent: number; failed: number }[];
  providerReport: ProviderReport[];
}

interface Props {
  campaigns: Campaign[];
  onUpdate: (campaigns: Campaign[]) => void;
  onToast: (msg: string, type: 'success' | 'error') => void;
}

function statusBadge(status: string, failedCount: number): { className: string; label: string } {
  switch (status) {
    case 'failed':
      return { className: 'bg-red-500/20 text-red-400 border-red-500/30', label: 'failed' };
    case 'sending':
      return { className: 'bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse', label: 'sending...' };
    case 'paused':
      return { className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', label: 'waiting — send next batch' };
    case 'pending':
      return { className: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30', label: 'ready to send' };
    case 'completed':
      if (failedCount > 0)
        return { className: 'bg-amber-500/20 text-amber-400 border-amber-500/30', label: 'completed (with errors)' };
      return { className: 'bg-green-500/20 text-green-400 border-green-500/30', label: 'completed' };
    default:
      return { className: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30', label: status };
  }
}

export default function CampaignStatus({ campaigns, onUpdate, onToast }: Props) {
  const [polling, setPolling] = useState(false);
  const [sendingBatchId, setSendingBatchId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);

  const hasSending = campaigns.some((c) => c.status === 'sending');

  // Auto-expand first pending/paused campaign
  useEffect(() => {
    if (expandedId) return;
    const active = campaigns.find((c) => c.status === 'paused' || c.status === 'pending');
    if (active) {
      setExpandedId(active.id);
      fetchDetail(active.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns]);

  useEffect(() => {
    if (!hasSending) {
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

          const stillSending = updated.some((c) => c.status === 'sending');
          if (!stillSending) {
            setPolling(false);
            clearInterval(interval);
          }
        }
      } catch {}
    }, 3000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSending]);

  useEffect(() => {
    if (!expandedId || !hasSending) return;
    const interval = setInterval(() => fetchDetail(expandedId), 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId, hasSending]);

  const fetchDetail = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/campaigns/${id}`);
      if (res.ok) {
        const data: CampaignDetail = await res.json();
        setDetail(data);
      }
    } catch {}
  }, []);

  async function handleToggleDetail(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    await fetchDetail(id);
  }

  async function handleSendBatch(id: number) {
    setSendingBatchId(id);
    try {
      const res = await fetch(`/api/campaigns/${id}/send-batch`, { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        onToast(data.error ?? 'Failed to start batch', 'error');
        return;
      }

      const providers = (data.providerBreakdown ?? [])
        .map((p: { provider: string; count: number }) => `${p.provider}: ${p.count}`)
        .join(', ');

      onToast(
        `Batch ${data.batchDay} started — sending ${data.batchSize.toLocaleString()} emails (${providers}). ${data.remainingAfter.toLocaleString()} left after this batch.`,
        'success'
      );

      const listRes = await fetch('/api/campaigns');
      if (listRes.ok) {
        const updated: Campaign[] = await listRes.json();
        onUpdate(updated);
      }

      if (expandedId === id) {
        await fetchDetail(id);
      }
    } catch {
      onToast('Network error starting batch', 'error');
    } finally {
      setSendingBatchId(null);
    }
  }

  if (campaigns.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
        Campaigns {polling && <span className="text-blue-400 normal-case">(live)</span>}
      </h2>
      <div className="space-y-2">
        {campaigns.map((c) => {
          const remaining = Math.max(0, c.totalRecipients - c.sentCount - c.failedCount);
          const sentPct = c.totalRecipients > 0 ? (c.sentCount / c.totalRecipients) * 100 : 0;
          const failedPct = c.totalRecipients > 0 ? (c.failedCount / c.totalRecipients) * 100 : 0;
          const badge = statusBadge(c.status, c.failedCount);
          const canSendBatch = c.status === 'pending' || c.status === 'paused';
          const isExpanded = expandedId === c.id;

          return (
            <div
              key={c.id}
              className={`bg-zinc-900 border rounded-lg p-4 space-y-3 ${
                canSendBatch ? 'border-yellow-800/50' : 'border-zinc-800'
              }`}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 cursor-pointer" onClick={() => handleToggleDetail(c.id)}>
                  <p className="font-medium text-zinc-100 truncate">{c.subject}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {new Date(c.createdAt).toLocaleString()}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full border ${badge.className}`}
                >
                  {badge.label}
                </span>
              </div>

              {/* Progress */}
              {c.totalRecipients > 0 && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-zinc-400">
                    <span>
                      <span className="text-green-400">{c.sentCount.toLocaleString()} sent</span>
                      {c.failedCount > 0 && (
                        <span className="text-red-400 ml-2">{c.failedCount.toLocaleString()} failed</span>
                      )}
                      {remaining > 0 && (
                        <span className="text-zinc-500 ml-2">{remaining.toLocaleString()} pending</span>
                      )}
                    </span>
                    <span>{c.totalRecipients.toLocaleString()} total</span>
                  </div>

                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden flex">
                    {sentPct > 0 && (
                      <div
                        className="h-full bg-green-500 transition-all duration-500"
                        style={{ width: `${sentPct}%` }}
                      />
                    )}
                    {failedPct > 0 && (
                      <div
                        className="h-full bg-red-500 transition-all duration-500"
                        style={{ width: `${failedPct}%` }}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Error message */}
              {c.errorMessage && (
                <div className="flex items-start gap-2 bg-red-950/40 border border-red-900/50 rounded-md px-3 py-2">
                  <span className="text-red-400 mt-0.5 shrink-0">!</span>
                  <p className="text-xs text-red-300 break-words">{c.errorMessage}</p>
                </div>
              )}

              {/* Sending in progress */}
              {c.status === 'sending' && (
                <div className="bg-blue-950/30 border border-blue-900/40 rounded-md px-3 py-2.5 text-xs text-blue-300">
                  Sending in progress... This page will update automatically.
                </div>
              )}

              {/* Send batch button — prominent for paused/pending */}
              {canSendBatch && (
                <div className="space-y-2">
                  <button
                    onClick={() => handleSendBatch(c.id)}
                    disabled={sendingBatchId === c.id}
                    className="w-full bg-yellow-600 hover:bg-yellow-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-4 rounded-md transition-colors text-sm"
                  >
                    {sendingBatchId === c.id
                      ? 'Starting batch...'
                      : c.status === 'paused'
                      ? `Continue Sending (${remaining.toLocaleString()} remaining)`
                      : `Send Today's Batch (${remaining.toLocaleString()} recipients)`}
                  </button>

                  {remaining > 0 && c.status === 'paused' && (
                    <p className="text-xs text-yellow-600 text-center">
                      Come back each day and click this button to send the next batch until all recipients are reached.
                    </p>
                  )}
                </div>
              )}

              {/* Expanded detail */}
              {isExpanded && detail && detail.id === c.id && (
                <div className="border-t border-zinc-800 pt-3 space-y-3">
                  {/* Schedule overview */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-zinc-800 rounded-md px-2 py-2">
                      <p className="text-lg font-bold text-zinc-100">{detail.dailyLimit.toLocaleString()}</p>
                      <p className="text-[10px] text-zinc-500 uppercase">per day</p>
                    </div>
                    <div className="bg-zinc-800 rounded-md px-2 py-2">
                      <p className="text-lg font-bold text-zinc-100">{detail.batchHistory.length}</p>
                      <p className="text-[10px] text-zinc-500 uppercase">batches sent</p>
                    </div>
                    <div className="bg-zinc-800 rounded-md px-2 py-2">
                      <p className="text-lg font-bold text-zinc-100">
                        {detail.daysRemaining > 0 ? `~${detail.daysRemaining}` : '0'}
                      </p>
                      <p className="text-[10px] text-zinc-500 uppercase">days left</p>
                    </div>
                  </div>

                  {/* Provider report */}
                  {detail.providerReport && detail.providerReport.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs text-zinc-500 font-medium">Provider report</p>
                      {detail.providerReport.map((p) => (
                        <div key={p.provider} className="bg-zinc-800/50 rounded px-3 py-2 space-y-1">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-zinc-300 font-medium w-20">{p.provider}</span>
                            {p.sent > 0 && <span className="text-green-400">{p.sent.toLocaleString()} sent</span>}
                            {p.failed > 0 && <span className="text-red-400">{p.failed.toLocaleString()} failed</span>}
                            {p.sent > 0 && p.failed === 0 && (
                              <span className="text-green-500 ml-auto text-[10px]">PROVEN</span>
                            )}
                            {p.failed > 0 && p.sent === 0 && (
                              <span className="text-red-500 ml-auto text-[10px]">FAILED</span>
                            )}
                          </div>
                          {p.errors.length > 0 && (
                            <div className="pl-[88px]">
                              {p.errors.map((err, i) => (
                                <p key={i} className="text-[10px] text-red-400/80">Reason: {err}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Batch history */}
                  {detail.batchHistory.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs text-zinc-500 font-medium">Batch history</p>
                      {detail.batchHistory.map((b) => (
                        <div key={b.day} className="flex items-center gap-2 text-xs bg-zinc-800/50 rounded px-2 py-1.5">
                          <span className="text-zinc-400 font-medium w-16">Batch {b.day}</span>
                          <span className="text-green-400">{b.sent.toLocaleString()} sent</span>
                          {b.failed > 0 && (
                            <span className="text-red-400">{b.failed.toLocaleString()} failed</span>
                          )}
                          <span className="text-zinc-600 ml-auto">{b.sent + b.failed} total</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Click to expand hint */}
              {!isExpanded && (
                <button
                  onClick={() => handleToggleDetail(c.id)}
                  className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors w-full text-center"
                >
                  Click to see details
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
