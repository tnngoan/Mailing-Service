'use client';

import { useEffect, useRef, useState } from 'react';
import CampaignStatus from '@/components/CampaignStatus';

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

// Lightweight client-side email counter — no server round-trip needed for preview
function countEmailsInCSV(text: string): number {
  const lines = text.split(/\r?\n/);
  let count = 0;
  for (const line of lines) {
    const cols = line.split(/[,;\t]/);
    for (const col of cols) {
      const val = col.trim().replace(/^["']|["']$/g, '').toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) count++;
    }
  }
  return count;
}

interface ProviderInfo {
  name: string;
  dailyLimit: number;
  usedToday: number;
  remaining: number;
  tier: string;
}

export default function Dashboard() {
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvCount, setCsvCount] = useState<number | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [totalDailyLimit, setTotalDailyLimit] = useState<number>(0);
  const [totalRemaining, setTotalRemaining] = useState<number>(0);
  const [capacityData, setCapacityData] = useState<{
    summary: { totalProviders: number; availableProviders: number; exhaustedProviders: number; totalDailyLimit: number; totalSentToday: number; totalRemaining: number; capacityPercent: number };
    providers: { provider: string; tier: string; configuredLimit: number; sentToday: number; providerReported: number | null; remaining: number; source: string; status: string; error?: string }[];
  } | null>(null);
  const [capacityLoading, setCapacityLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 6000);
  }

  function refreshCampaigns() {
    fetch('/api/campaigns')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setCampaigns(data);
      })
      .catch(() => {});
  }

  function refreshCapacity() {
    setCapacityLoading(true);
    fetch('/api/capacity')
      .then((r) => r.json())
      .then((data) => {
        if (data.providers) {
          setCapacityData(data);
          setTotalRemaining(data.summary?.totalRemaining ?? 0);
          setTotalDailyLimit(data.summary?.totalDailyLimit ?? 0);
        }
      })
      .catch(() => {})
      .finally(() => setCapacityLoading(false));
  }

  useEffect(() => {
    refreshCampaigns();
    refreshCapacity();

    fetch('/api/providers')
      .then((r) => r.json())
      .then((data) => {
        setProviders(data.providers ?? []);
        setTotalDailyLimit(data.totalDailyLimit ?? 0);
        setTotalRemaining(data.totalRemaining ?? data.totalDailyLimit ?? 0);
      })
      .catch(() => {});
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setCsvFile(file);
    setCsvCount(null);

    if (!file) return;

    const text = await file.text();
    const count = countEmailsInCSV(text);

    if (count === 0) {
      showToast('No valid email addresses found in that file.', 'error');
      setCsvFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setCsvCount(count);
  }

  function handleClearFile() {
    setCsvFile(null);
    setCsvCount(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSend() {
    if (!csvFile || !subject.trim() || !content.trim()) return;

    setSending(true);
    try {
      const formData = new FormData();
      formData.append('subject', subject.trim());
      formData.append('content', content.trim());
      formData.append('file', csvFile);

      const res = await fetch('/api/campaigns', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error ?? 'Failed to create campaign.', 'error');
      } else {
        const daysNeeded = data.daysNeeded ?? 1;
        const totalRecipients = data.totalRecipients ?? 0;

        if (daysNeeded > 1) {
          showToast(
            `Campaign created with ${totalRecipients.toLocaleString()} recipients. Will need ~${daysNeeded} daily batches (${data.dailyLimit}/day). Click "Send Today's Batch" to start.`,
            'success'
          );
        } else {
          showToast(
            `Campaign created with ${totalRecipients.toLocaleString()} recipients. Click "Send Today's Batch" to start sending.`,
            'success'
          );
        }

        refreshCampaigns();

        // Reset form
        setSubject('');
        setContent('');
        setCsvFile(null);
        setCsvCount(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch {
      showToast('Network error. Try again.', 'error');
    } finally {
      setSending(false);
    }
  }

  const canSend = !!csvFile && !!subject.trim() && !!content.trim() && !sending;

  // Parse diagnostics from the most recent campaign with error data
  const diagnosticCampaign = campaigns.find((c) => c.errorMessage);
  let diagnostics: {
    provider: string;
    status: string;
    assigned: number;
    sent: number;
    failed: number;
    skipped: number;
    reason?: string;
    errors: string[];
  }[] = [];
  try {
    if (diagnosticCampaign?.errorMessage) {
      const parsed = JSON.parse(diagnosticCampaign.errorMessage);
      if (Array.isArray(parsed)) diagnostics = parsed;
    }
  } catch {}

  const hasDiagnostics = diagnostics.length > 0;

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-100">Bulk Email Sender</h1>
        <p className="text-zinc-500 mt-1 text-sm">
          Upload a CSV, write your message, then send daily batches across multiple providers.
        </p>
      </div>

      <div className={`flex gap-6 ${hasDiagnostics ? 'flex-col lg:flex-row' : ''}`}>
      {/* Left column — main content */}
      <div className={hasDiagnostics ? 'flex-1 min-w-0' : 'max-w-3xl mx-auto w-full'}>

      {/* Capacity dashboard */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 mb-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Provider Capacity</span>
          <button
            onClick={refreshCapacity}
            disabled={capacityLoading}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
          >
            {capacityLoading ? 'Checking...' : 'Refresh'}
          </button>
        </div>

        {/* Summary bar */}
        {capacityData && (
          <div className="flex items-center gap-4 text-xs">
            <div className="flex-1">
              <div className="flex justify-between mb-1">
                <span className="text-zinc-400">
                  {capacityData.summary.totalSentToday.toLocaleString()} sent today
                </span>
                <span className={capacityData.summary.totalRemaining > 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {capacityData.summary.totalRemaining.toLocaleString()} remaining
                </span>
              </div>
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${100 - (capacityData.summary.capacityPercent)}%` }}
                />
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-lg font-bold text-zinc-100">{capacityData.summary.capacityPercent}%</p>
              <p className="text-[10px] text-zinc-500">available</p>
            </div>
          </div>
        )}

        {/* Provider table */}
        {capacityData && capacityData.providers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800">
                  <th className="text-left py-1.5 px-2 font-medium">#</th>
                  <th className="text-left py-1.5 px-2 font-medium">Provider</th>
                  <th className="text-right py-1.5 px-2 font-medium">Limit</th>
                  <th className="text-right py-1.5 px-2 font-medium">Sent</th>
                  <th className="text-right py-1.5 px-2 font-medium">Remaining</th>
                  <th className="text-right py-1.5 px-2 font-medium">Capacity</th>
                  <th className="text-center py-1.5 px-2 font-medium">Source</th>
                  <th className="text-center py-1.5 px-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {capacityData.providers.map((p, i) => {
                  const pct = p.configuredLimit > 0 ? Math.round((p.remaining / p.configuredLimit) * 100) : 0;
                  const statusColor = p.status === 'available'
                    ? 'text-green-400 bg-green-950/50'
                    : p.status === 'exhausted'
                    ? 'text-red-400 bg-red-950/50'
                    : 'text-yellow-400 bg-yellow-950/50';

                  return (
                    <tr key={p.provider} className="border-b border-zinc-800/50 hover:bg-zinc-800/20">
                      <td className="py-1.5 px-2 text-zinc-600">{i + 1}</td>
                      <td className="py-1.5 px-2">
                        <span className="text-zinc-200 font-medium">{p.provider}</span>
                        {p.tier === 'proven' && (
                          <span className="ml-1.5 text-[9px] text-green-600">PROVEN</span>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-right text-zinc-400">{p.configuredLimit.toLocaleString()}</td>
                      <td className="py-1.5 px-2 text-right text-zinc-300">{p.sentToday.toLocaleString()}</td>
                      <td className={`py-1.5 px-2 text-right font-medium ${p.remaining > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {p.remaining.toLocaleString()}
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-12 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${pct > 50 ? 'bg-green-500' : pct > 0 ? 'bg-yellow-500' : 'bg-red-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-zinc-500 w-7 text-right">{pct}%</span>
                        </div>
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                          p.source === 'api' ? 'bg-blue-950/50 text-blue-400' :
                          p.source === 'db' ? 'bg-zinc-800 text-zinc-400' :
                          'bg-zinc-800 text-zinc-600'
                        }`}>
                          {p.source}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${statusColor}`}>
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Fallback: simple provider tags if capacity not loaded yet */}
        {!capacityData && providers.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-zinc-400 flex-wrap">
            {providers.map((p) => (
              <span key={p.name} className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-zinc-300">
                {p.name} <span className="text-zinc-500">{p.dailyLimit}/day</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Compose + Send */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6 space-y-5">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
          New Campaign
        </h2>

        {/* CSV picker */}
        <div>
          <label className="block text-xs text-zinc-500 mb-1.5">
            Recipient list <span className="text-zinc-600">(CSV)</span>
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={handleFileChange}
          />
          {csvFile ? (
            <div className="flex items-center gap-3 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2.5">
              <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-zinc-200 truncate flex-1">{csvFile.name}</span>
              {csvCount !== null && (
                <>
                  <span className="text-xs text-emerald-400 shrink-0 font-medium">
                    {csvCount.toLocaleString()} recipients
                  </span>
                  {totalDailyLimit > 0 && csvCount > totalDailyLimit && (
                    <span className="text-xs text-zinc-500 shrink-0">
                      (~{Math.ceil(csvCount / totalDailyLimit)} days)
                    </span>
                  )}
                </>
              )}
              <button
                onClick={handleClearFile}
                className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0 ml-1"
                title="Remove file"
              >
                x
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 border border-dashed border-zinc-600 hover:border-zinc-500 rounded-md px-3 py-3 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Upload CSV
            </button>
          )}
        </div>

        {/* Subject */}
        <div>
          <label className="block text-xs text-zinc-500 mb-1.5">Subject line</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Your weekly update"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Body */}
        <div>
          <label className="block text-xs text-zinc-500 mb-1.5">Email body</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write your email content here..."
            rows={12}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-y font-mono"
          />
        </div>

        <button
          onClick={handleSend}
          disabled={!canSend}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors text-sm"
        >
          {sending
            ? 'Creating campaign...'
            : csvCount
            ? `Create Campaign (${csvCount.toLocaleString()} recipients)`
            : 'Create Campaign'}
        </button>
      </div>

      {/* Campaign history */}
      <CampaignStatus
        campaigns={campaigns}
        onUpdate={setCampaigns}
        onToast={showToast}
      />

      </div>{/* End left column */}

      {/* Right column — Error Diagnostic Report */}
      {hasDiagnostics && (
        <div className="lg:w-96 shrink-0">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 sticky top-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
                Error Report
              </h2>
              <span className="text-[10px] text-zinc-600">
                Campaign: {diagnosticCampaign?.subject?.slice(0, 30)}...
              </span>
            </div>

            {diagnostics.map((d) => {
              const statusColor =
                d.status === 'ok'
                  ? 'text-green-400 border-green-900/50 bg-green-950/30'
                  : d.status === 'skipped'
                  ? 'text-yellow-400 border-yellow-900/50 bg-yellow-950/30'
                  : 'text-red-400 border-red-900/50 bg-red-950/30';

              const statusIcon =
                d.status === 'ok' ? '✓' : d.status === 'skipped' ? '⊘' : '✗';

              return (
                <div
                  key={d.provider}
                  className={`border rounded-lg p-3 space-y-2 ${statusColor}`}
                >
                  {/* Provider header */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {statusIcon} {d.provider}
                    </span>
                    <span className="text-[10px] uppercase font-bold">
                      {d.status}
                    </span>
                  </div>

                  {/* Stats */}
                  <div className="flex gap-3 text-[11px]">
                    <span className="text-zinc-400">
                      Assigned: <span className="text-zinc-300">{d.assigned}</span>
                    </span>
                    {d.sent > 0 && (
                      <span className="text-green-400">Sent: {d.sent}</span>
                    )}
                    {d.failed > 0 && (
                      <span className="text-red-400">Failed: {d.failed}</span>
                    )}
                    {d.skipped > 0 && (
                      <span className="text-yellow-400">Skipped: {d.skipped}</span>
                    )}
                  </div>

                  {/* Diagnosis */}
                  {d.reason && (
                    <div className="bg-black/30 rounded px-2 py-1.5">
                      <p className="text-[11px] font-medium text-zinc-300">
                        Diagnosis: {d.reason}
                      </p>
                    </div>
                  )}

                  {/* Raw errors */}
                  {d.errors.length > 0 && (
                    <div className="space-y-0.5">
                      <p className="text-[10px] text-zinc-500 font-medium">Error details:</p>
                      {d.errors.slice(0, 3).map((err, i) => (
                        <p key={i} className="text-[10px] text-zinc-500 break-words font-mono">
                          {err.slice(0, 150)}
                        </p>
                      ))}
                      {d.errors.length > 3 && (
                        <p className="text-[10px] text-zinc-600">
                          +{d.errors.length - 3} more errors
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Summary */}
            <div className="border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
              <p>
                Total: {diagnostics.reduce((s, d) => s + d.sent, 0)} sent,{' '}
                {diagnostics.reduce((s, d) => s + d.failed, 0)} failed,{' '}
                {diagnostics.reduce((s, d) => s + d.skipped, 0)} skipped
              </p>
            </div>
          </div>
        </div>
      )}
      </div>{/* End flex container */}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 max-w-md w-full mx-4 px-5 py-3.5 rounded-lg text-sm font-medium shadow-xl z-50 border ${
            toast.type === 'success'
              ? 'bg-green-900/90 border-green-700 text-green-100'
              : 'bg-red-900/90 border-red-700 text-red-100'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </main>
  );
}
