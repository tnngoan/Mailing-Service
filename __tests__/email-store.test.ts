import { storeEmails, getEmails, clearEmails } from '../lib/email-store';

describe('email-store', () => {
  afterEach(() => {
    clearEmails(1);
    clearEmails(2);
  });

  test('stores and retrieves emails for a campaign', () => {
    storeEmails(1, ['a@example.com', 'b@example.com']);
    expect(getEmails(1)).toEqual(['a@example.com', 'b@example.com']);
  });

  test('returns empty array for unknown campaign id', () => {
    expect(getEmails(999)).toEqual([]);
  });

  test('clears emails after processing', () => {
    storeEmails(1, ['a@example.com']);
    clearEmails(1);
    expect(getEmails(1)).toEqual([]);
  });

  test('isolates separate campaign ids', () => {
    storeEmails(1, ['a@example.com']);
    storeEmails(2, ['b@example.com', 'c@example.com']);
    expect(getEmails(1)).toEqual(['a@example.com']);
    expect(getEmails(2)).toEqual(['b@example.com', 'c@example.com']);
  });

  test('overwrites existing entry when called twice with the same id', () => {
    storeEmails(1, ['a@example.com']);
    storeEmails(1, ['z@example.com']);
    expect(getEmails(1)).toEqual(['z@example.com']);
  });

  test('clearEmails is a no-op for unknown id', () => {
    expect(() => clearEmails(999)).not.toThrow();
  });
});
