jest.mock('../lib/prisma', () => ({
  prisma: {
    campaign: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    recipient: {
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
  },
}));

jest.mock('../lib/sendgrid', () => ({
  buildHtmlEmail: jest.fn(() => '<html>test</html>'),
}));

jest.mock('../lib/providers', () => ({
  getProviders: jest.fn(() => [
    {
      name: 'test-provider',
      dailyLimit: 100,
      batchSize: 50,
      sendBatch: jest.fn(),
    },
  ]),
}));

import { prisma } from '../lib/prisma';
import { getProviders } from '../lib/providers';
import { processBatch } from '../lib/worker';

const mockFindUnique = prisma.campaign.findUnique as jest.Mock;
const mockCampaignUpdate = prisma.campaign.update as jest.Mock;
const mockRecipientFindMany = prisma.recipient.findMany as jest.Mock;
const mockRecipientUpdate = prisma.recipient.update as jest.Mock;
const mockRecipientCount = prisma.recipient.count as jest.Mock;
const mockRecipientGroupBy = prisma.recipient.groupBy as jest.Mock;

const FAKE_CAMPAIGN = {
  id: 1,
  subject: 'Test',
  content: 'Hello',
  status: 'sending',
  totalRecipients: 3,
  sentCount: 0,
  failedCount: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCampaignUpdate.mockResolvedValue({});
  mockRecipientUpdate.mockResolvedValue({});
});

describe('processBatch', () => {
  test('does nothing when campaign not found', async () => {
    mockFindUnique.mockResolvedValue(null);

    await processBatch(99, 1);

    expect(mockCampaignUpdate).not.toHaveBeenCalled();
  });

  test('does nothing when no pending recipients', async () => {
    mockFindUnique.mockResolvedValue(FAKE_CAMPAIGN);
    mockRecipientFindMany.mockResolvedValue([]);

    await processBatch(1, 1);

    expect(mockCampaignUpdate).not.toHaveBeenCalled();
  });

  test('sends emails and updates recipient statuses', async () => {
    const recipients = [
      { id: 1, email: 'a@example.com', provider: 'test-provider', status: 'pending' },
      { id: 2, email: 'b@example.com', provider: 'test-provider', status: 'pending' },
    ];

    mockFindUnique.mockResolvedValue(FAKE_CAMPAIGN);
    mockRecipientFindMany.mockResolvedValue(recipients);
    mockRecipientGroupBy.mockResolvedValue([
      { status: 'sent', _count: 2 },
    ]);
    mockRecipientCount.mockResolvedValue(0); // no pending left

    const providers = (getProviders as jest.Mock)();
    providers[0].sendBatch.mockResolvedValue([
      { success: true, email: 'a@example.com', provider: 'test-provider' },
      { success: true, email: 'b@example.com', provider: 'test-provider' },
    ]);

    await processBatch(1, 1);

    expect(providers[0].sendBatch).toHaveBeenCalledTimes(1);
    expect(mockRecipientUpdate).toHaveBeenCalledTimes(2);
    expect(mockCampaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'completed' }),
      })
    );
  });

  test('sets campaign to paused when pending remain', async () => {
    const recipients = [
      { id: 1, email: 'a@example.com', provider: 'test-provider', status: 'pending' },
    ];

    mockFindUnique.mockResolvedValue(FAKE_CAMPAIGN);
    mockRecipientFindMany.mockResolvedValue(recipients);
    mockRecipientGroupBy.mockResolvedValue([
      { status: 'sent', _count: 1 },
    ]);
    mockRecipientCount.mockResolvedValue(5); // 5 still pending

    const providers = (getProviders as jest.Mock)();
    providers[0].sendBatch.mockResolvedValue([
      { success: true, email: 'a@example.com', provider: 'test-provider' },
    ]);

    await processBatch(1, 1);

    expect(mockCampaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'paused' }),
      })
    );
  });
});
