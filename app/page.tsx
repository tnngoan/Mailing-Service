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

  useEffect(() => {
    refreshCampaigns();

    fetch('/api/providers')
      .then((r) => r.json())
      .then((data) => {
        setProviders(data.providers ?? []);
        setTotalDailyLimit(data.totalDailyLimit ?? 0);
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

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-100">Bulk Email Sender</h1>
        <p className="text-zinc-500 mt-1 text-sm">
          Upload a CSV, write your message, then send daily batches across multiple providers.
        </p>
      </div>

      {/* Provider capacity banner */}
      {providers.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-zinc-400 flex-wrap">
            <span className="text-zinc-500">Providers:</span>
            {providers.map((p) => (
              <span
                key={p.name}
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-zinc-300"
              >
                {p.name} <span className="text-zinc-500">{p.dailyLimit}/day</span>
              </span>
            ))}
          </div>
          <span className="text-xs text-emerald-400 font-medium whitespace-nowrap ml-2">
            {totalDailyLimit.toLocaleString()}/day total
          </span>
        </div>
      )}

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
