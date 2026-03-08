import { parseEmailsFromCSV } from '../lib/csv-parser';

describe('parseEmailsFromCSV', () => {
  test('parses a single-column CSV', () => {
    const csv = 'alice@example.com\nbob@example.com\ncharlie@example.com';
    expect(parseEmailsFromCSV(csv)).toEqual([
      'alice@example.com',
      'bob@example.com',
      'charlie@example.com',
    ]);
  });

  test('parses a CSV with a header row', () => {
    const csv = 'email,name\nalice@example.com,Alice\nbob@example.com,Bob';
    const result = parseEmailsFromCSV(csv);
    expect(result).toContain('alice@example.com');
    expect(result).toContain('bob@example.com');
    expect(result).not.toContain('email'); // header skipped
  });

  test('deduplicates email addresses', () => {
    const csv = 'alice@example.com\nalice@example.com\nbob@example.com';
    expect(parseEmailsFromCSV(csv)).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
  });

  test('normalises to lowercase', () => {
    const csv = 'Alice@Example.COM\nBOB@EXAMPLE.COM';
    expect(parseEmailsFromCSV(csv)).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
  });

  test('strips surrounding quotes', () => {
    const csv = '"alice@example.com"\n\'bob@example.com\'';
    expect(parseEmailsFromCSV(csv)).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
  });

  test('handles semicolon-separated columns', () => {
    const csv = 'alice@example.com;Alice\nbob@example.com;Bob';
    expect(parseEmailsFromCSV(csv)).toContain('alice@example.com');
    expect(parseEmailsFromCSV(csv)).toContain('bob@example.com');
  });

  test('handles tab-separated columns', () => {
    const csv = 'alice@example.com\tAlice\nbob@example.com\tBob';
    expect(parseEmailsFromCSV(csv)).toContain('alice@example.com');
    expect(parseEmailsFromCSV(csv)).toContain('bob@example.com');
  });

  test('handles Windows-style CRLF line endings', () => {
    const csv = 'alice@example.com\r\nbob@example.com\r\n';
    expect(parseEmailsFromCSV(csv)).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
  });

  test('skips invalid email-like strings', () => {
    const csv = 'not-an-email\nalice@example.com\n@nodomain\nmissing@';
    expect(parseEmailsFromCSV(csv)).toEqual(['alice@example.com']);
  });

  test('returns empty array for empty input', () => {
    expect(parseEmailsFromCSV('')).toEqual([]);
    expect(parseEmailsFromCSV('   \n  \n  ')).toEqual([]);
  });

  test('returns empty array when no valid emails found', () => {
    expect(parseEmailsFromCSV('name,age\nAlice,30\nBob,25')).toEqual([]);
  });

  test('handles large input without duplicates', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => `user${i}@example.com`);
    const result = parseEmailsFromCSV(rows.join('\n'));
    expect(result).toHaveLength(1000);
    expect(new Set(result).size).toBe(1000); // all unique
  });
});
