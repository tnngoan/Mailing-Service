/**
 * In-memory store for email lists during campaign processing.
 * Emails are never written to the database — they live here only
 * for the duration of the send, then are cleared.
 */

const store = new Map<number, string[]>();

export function storeEmails(campaignId: number, emails: string[]): void {
  store.set(campaignId, emails);
}

export function getEmails(campaignId: number): string[] {
  return store.get(campaignId) ?? [];
}

export function clearEmails(campaignId: number): void {
  store.delete(campaignId);
}
