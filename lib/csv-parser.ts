/**
 * Parses a CSV string or Buffer and returns a deduplicated array of valid email addresses.
 * Accepts CSVs with or without a header row. Any column containing "@" is treated as email.
 */
export function parseEmailsFromCSV(raw: string): string[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const seen = new Set<string>();
  const emails: string[] = [];

  for (const line of lines) {
    // Split by comma, semicolon, or tab
    const cols = line.split(/[,;\t]/);
    for (const col of cols) {
      const candidate = col.trim().replace(/^["']|["']$/g, '').toLowerCase();
      if (isValidEmail(candidate) && !seen.has(candidate)) {
        seen.add(candidate);
        emails.push(candidate);
      }
    }
  }

  return emails;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
