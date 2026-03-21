import { supabase } from './supabase';

export interface NewsletterDraft {
  id: string;
  subject: string;
  body: string;
  status: string;
  model: string;
  token_usage: { input_tokens?: number; output_tokens?: number } | null;
  created_at: string;
}

export async function loadLatestDraft(): Promise<NewsletterDraft> {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase
    .from('newsletter_drafts')
    .select('*')
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function markDraftAsSent(draftId: string): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from('newsletter_drafts')
    .update({ status: 'sent' })
    .eq('id', draftId);

  if (error) console.error('Failed to mark draft as sent:', error.message);
}
