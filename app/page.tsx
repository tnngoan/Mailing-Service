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
  createdAt: string;
}

export default function Dashboard() {
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [emailCount, setEmailCount] = useState<number | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeCampaignId, setActiveCampaignId] = useState<number | null>(null);

  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  }

  async function loadData() {
    const [countRes, campaignRes] = await Promise.all([
      fetch('/api/emails'),
      fetch('/api/campaigns'),
    ]);
    if (countRes.ok) {
      const { count } = await countRes.json();
      setEmailCount(count);
    }
    if (campaignRes.ok) {
      const data = await campaignRes.json();
      setCampaigns(data);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleSend() {
    if (!subject.trim() || !content.trim()) {
      showToast('Subject and content are required.', 'error');
      return;
    }
    setSending(true);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, content }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? 'Failed to start campaign.', 'error');
      } else {
        showToast(`Campaign started! Sending to ${data.totalRecipients.toLocaleString()} recipients.`, 'success');
        setActiveCampaignId(data.id);
        setCampaigns((prev) => [data, ...prev]);
      }
    } catch {
      showToast('Network error. Try again.', 'error');
    } finally {
      setSending(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/emails', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error ?? 'Upload failed.', 'error');
      } else {
        showToast(
          `Uploaded! ${data.inserted.toLocaleString()} new emails added (${data.duplicatesSkipped} duplicates skipped). Total: ${data.total.toLocaleString()}`,
          'success'
        );
        setEmailCount(data.total);
      }
    } catch {
      showToast('Upload failed. Try again.', 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-100">Bulk Email Sender</h1>
        <p className="text-zinc-500 mt-1 text-sm">
          Send campaigns to large lists via SendGrid
        </p>
      </div>

      {/* Stats bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-5 py-4 mb-6 flex items-center gap-3">
        <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
        <span className="text-sm text-zinc-400">
          {emailCount === null ? (
            'Loading...'
          ) : (
            <>
              <span className="text-zinc-100 font-semibold">{emailCount.toLocaleString()}</span> email addresses in database
            </>
          )}
        </span>
        <div className="ml-auto">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 px-3 py-1.5 rounded-md border border-zinc-700 transition-colors"
          >
            {uploading ? 'Uploading...' : 'Upload CSV'}
          </button>
        </div>
      </div>

      {/* Compose */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
          Compose Campaign
        </h2>

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

        <div>
          <label className="block text-xs text-zinc-500 mb-1.5">Email body</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write your email content here…"
            rows={12}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-y font-mono"
          />
        </div>

        <button
          onClick={handleSend}
          disabled={sending || !subject.trim() || !content.trim()}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors text-sm"
        >
          {sending ? 'Starting campaign...' : 'Send Email Campaign'}
        </button>
      </div>

      {/* Campaigns */}
      <CampaignStatus
        campaigns={campaigns}
        activeCampaignId={activeCampaignId}
        onUpdate={setCampaigns}
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
