const { createClient } = require('@libsql/client');

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function run() {
  console.log('Creating tables in Turso...');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS Campaign (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      totalRecipients INTEGER NOT NULL DEFAULT 0,
      sentCount INTEGER NOT NULL DEFAULT 0,
      failedCount INTEGER NOT NULL DEFAULT 0,
      errorMessage TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS Recipient (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaignId INTEGER NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      provider TEXT,
      sentAt DATETIME,
      error TEXT,
      batchDay INTEGER,
      FOREIGN KEY (campaignId) REFERENCES Campaign(id) ON DELETE CASCADE
    )
  `);

  await client.execute(`CREATE INDEX IF NOT EXISTS idx_recipient_campaign_status ON Recipient(campaignId, status)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_recipient_campaign_batchday ON Recipient(campaignId, batchDay)`);

  // Verify
  const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  console.log('Tables:', tables.rows.map(r => r.name));

  const campaignCols = await client.execute("PRAGMA table_info(Campaign)");
  console.log('Campaign columns:', campaignCols.rows.map(r => r.name));

  const recipientCols = await client.execute("PRAGMA table_info(Recipient)");
  console.log('Recipient columns:', recipientCols.rows.map(r => r.name));

  console.log('Done!');
}

run().catch(console.error);
