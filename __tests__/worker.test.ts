jest.mock('../lib/prisma', () => ({
  prisma: {
    campaign: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../lib/sendgrid', () => ({
  sendBatch: jest.fn(),
}));

jest.mock('../lib/email-store', () => ({
  getEmails: jest.fn(),
  clearEmails: jest.fn(),
}));

import { prisma } from '../lib/prisma';
import { sendBatch } from '../lib/sendgrid';
import { getEmails, clearEmails } from '../lib/email-store';
import { processCampaign } from '../lib/worker';

const mockFindUnique = prisma.campaign.findUnique as jest.Mock;
const mockUpdate = prisma.campaign.update as jest.Mock;
const mockSendBatch = sendBatch as jest.Mock;
const mockGetEmails = getEmails as jest.Mock;
const mockClearEmails = clearEmails as jest.Mock;

const FAKE_CAMPAIGN = {
  id: 1,
  subject: 'Test',
  content: 'Hello',
  status: 'queued',
  totalRecipients: 0,
  sentCount: 0,
  failedCount: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdate.mockResolvedValue({});
});

describe('processCampaign', () => {
  test('marks campaign failed when no emails in store', async () => {
    mockFindUnique.mockResolvedValue(FAKE_CAMPAIGN);
    mockGetEmails.mockReturnValue([]);

    await processCampaign(1);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
    );
    expect(mockSendBatch).not.toHaveBeenCalled();
    expect(mockClearEmails).toHaveBeenCalledWith(1);
  });

  test('marks campaign failed when campaign not found', async () => {
    mockFindUnique.mockResolvedValue(null);

    await processCampaign(99);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSendBatch).not.toHaveBeenCalled();
  });

  test('sends all emails and marks campaign completed', async () => {
    const emails = ['a@example.com', 'b@example.com', 'c@example.com'];
    mockFindUnique.mockResolvedValue(FAKE_CAMPAIGN);
    mockGetEmails.mockReturnValue(emails);
    mockSendBatch.mockResolvedValue(
      emails.map((email) => ({ success: true, email }))
    );

    await processCampaign(1);

    expect(mockSendBatch).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'completed', sentCount: 3, failedCount: 0 }),
      })
    );
    expect(mockClearEmails).toHaveBeenCalledWith(1);
  });

  test('tracks failed sends in failedCount', async () => {
    const emails = ['a@example.com', 'b@example.com'];
    mockFindUnique.mockResolvedValue(FAKE_CAMPAIGN);
    mockGetEmails.mockReturnValue(emails);
    mockSendBatch.mockResolvedValue([
      { success: true, email: 'a@example.com' },
      { success: false, email: 'b@example.com', error: 'rejected' },
    ]);

    await processCampaign(1);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'completed', sentCount: 1, failedCount: 1 }),
      })
    );
  });

  test('splits emails into batches of 500', async () => {
    const emails = Array.from({ length: 1100 }, (_, i) => `user${i}@example.com`);
    mockFindUnique.mockResolvedValue(FAKE_CAMPAIGN);
    mockGetEmails.mockReturnValue(emails);
    mockSendBatch.mockResolvedValue(
      emails.slice(0, 500).map((email) => ({ success: true, email }))
    );

    await processCampaign(1);

    // 1100 emails → 3 batches: 500, 500, 100
    expect(mockSendBatch).toHaveBeenCalledTimes(3);
    expect(mockSendBatch.mock.calls[0][0]).toHaveLength(500);
    expect(mockSendBatch.mock.calls[1][0]).toHaveLength(500);
    expect(mockSendBatch.mock.calls[2][0]).toHaveLength(100);
  });

  test('marks campaign failed and clears store on unexpected error', async () => {
    mockFindUnique.mockResolvedValue(FAKE_CAMPAIGN);
    mockGetEmails.mockReturnValue(['a@example.com']);
    mockSendBatch.mockRejectedValue(new Error('Unexpected crash'));

    await processCampaign(1);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
    );
    expect(mockClearEmails).toHaveBeenCalledWith(1);
  });
});
