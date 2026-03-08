// Mock @sendgrid/mail before any imports
jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: jest.fn(),
}));

import sgMail from '@sendgrid/mail';
import { sendBatch } from '../lib/sendgrid';

const mockSend = sgMail.send as jest.Mock;

beforeEach(() => {
  mockSend.mockReset();
  process.env.SENDER_EMAIL = 'sender@example.com';
  process.env.SENDER_NAME = 'Test Sender';
});

describe('sendBatch', () => {
  test('returns success results when SendGrid accepts the batch', async () => {
    mockSend.mockResolvedValueOnce([{ statusCode: 202 }, {}]);

    const results = await sendBatch(
      ['a@example.com', 'b@example.com'],
      'Test subject',
      'Test content'
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
    expect(results.map((r) => r.email)).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });

  test('returns failure results when SendGrid rejects the batch', async () => {
    const sgError = Object.assign(new Error('Unauthorized'), {
      response: { body: { errors: [{ message: 'The provided API key is invalid.' }] } },
    });
    mockSend.mockRejectedValueOnce(sgError);

    const results = await sendBatch(
      ['a@example.com'],
      'Subject',
      'Content'
    );

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('The provided API key is invalid.');
  });

  test('falls back to err.message when response body has no errors array', async () => {
    const sgError = new Error('Network failure');
    mockSend.mockRejectedValueOnce(sgError);

    const results = await sendBatch(['a@example.com'], 'S', 'C');
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Network failure');
  });

  test('sends personalizations — one per recipient', async () => {
    mockSend.mockResolvedValueOnce([{ statusCode: 202 }, {}]);

    const emails = ['a@example.com', 'b@example.com', 'c@example.com'];
    await sendBatch(emails, 'Subject', 'Content');

    const callArg = mockSend.mock.calls[0][0];
    expect(callArg.personalizations).toHaveLength(3);
    expect(callArg.personalizations[0].to).toEqual([{ email: 'a@example.com' }]);
    expect(callArg.personalizations[1].to).toEqual([{ email: 'b@example.com' }]);
  });

  test('includes subject, text and html in the SendGrid payload', async () => {
    mockSend.mockResolvedValueOnce([{ statusCode: 202 }, {}]);

    await sendBatch(['a@example.com'], 'Hello World', 'Plain text body');

    const callArg = mockSend.mock.calls[0][0];
    expect(callArg.subject).toBe('Hello World');
    expect(callArg.text).toBe('Plain text body');
    expect(callArg.html).toContain('Hello World'); // subject appears in HTML template
    expect(callArg.html).toContain('Plain text body');
  });
});
