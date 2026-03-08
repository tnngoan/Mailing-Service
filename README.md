# Bulk Email Sender

A minimal, production-ready bulk email campaign tool built with Next.js + SendGrid + SQLite.

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `SENDGRID_API_KEY` — your SendGrid API key
- `SENDER_EMAIL` — verified sender email in SendGrid
- `SENDER_NAME` — display name (optional)
- `DATABASE_URL` — keep as `file:./dev.db` for local SQLite

### 3. Initialize the database

```bash
npm run db:migrate
```

Or for a faster first-time setup (skips migration history):

```bash
npm run db:push
```

### 4. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Usage

1. **Upload your email list** — click "Upload CSV" and select a `.csv` file. Any column containing `@` is treated as email addresses. Duplicates are automatically skipped.

2. **Compose your campaign** — fill in the subject line and email body.

3. **Send** — click "Send Email Campaign". The campaign starts immediately in the background and status updates in real time.

### CSV Format

Any of these work:

```
# Single column
email@example.com
another@example.com

# With header
email,name
user@example.com,Alice

# Semicolon or tab separated
user1@example.com;John
user2@example.com	Jane
```

---

## Architecture

```
app/
  page.tsx                 # Single-page dashboard (client component)
  layout.tsx               # Root layout
  api/
    emails/route.ts        # GET (count) + POST (CSV upload)
    campaigns/
      route.ts             # GET (list) + POST (create + start)
      [id]/route.ts        # GET (poll status)

components/
  CampaignStatus.tsx       # Live-polling campaign list

lib/
  prisma.ts                # Prisma client singleton
  sendgrid.ts              # SendGrid sender + HTML template builder
  csv-parser.ts            # Zero-dependency CSV email extractor
  worker.ts                # Background campaign processor

prisma/
  schema.prisma            # Email + Campaign models
```

### Sending flow

1. User clicks "Send Email Campaign"
2. API creates a `Campaign` record (status: `queued`)
3. `processCampaign()` runs asynchronously in the background
4. Emails are fetched in batches of **500** using cursor pagination
5. Each batch is sent via SendGrid (parallel within batch)
6. **1.5 second delay** between batches (avoids rate limits)
7. `sent_count` is updated after each batch
8. UI polls `/api/campaigns` every 2 seconds while a campaign is active

---

## Performance

| Recipients | Estimated time |
|---|---|
| 10,000 | ~30 seconds |
| 100,000 | ~5 minutes |
| 500,000 | ~25 minutes |

For 500k+ recipients, use Railway or Render (long-running process). Vercel functions time out at 10 minutes.

---

## Deployment

### Railway (recommended for large lists)

```bash
# Install Railway CLI
npm install -g @railway/cli

railway login
railway init
railway up

# Set environment variables in Railway dashboard
# DATABASE_URL: file:./prisma/prod.db  (or use Railway's Postgres)
```

### Render

1. Create a new **Web Service** pointing to this repo
2. Build command: `npm install && npm run db:push && npm run build`
3. Start command: `npm start`
4. Add environment variables in Render dashboard

### Vercel (best for small lists < 50k)

```bash
npm install -g vercel
vercel

# Add env vars:
vercel env add SENDGRID_API_KEY
vercel env add SENDER_EMAIL
vercel env add DATABASE_URL
```

> **Note:** Vercel serverless functions have a max duration of 10 minutes. For large lists, the worker will be killed mid-send. Use Railway or Render for 100k+ recipients.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SENDGRID_API_KEY` | Yes | SendGrid API key (starts with `SG.`) |
| `SENDER_EMAIL` | Yes | Verified sender email address |
| `SENDER_NAME` | No | Display name (default: "Newsletter") |
| `DATABASE_URL` | Yes | SQLite path, e.g. `file:./dev.db` |

---

## Preventing Duplicate Sends

- Email addresses are stored with a `UNIQUE` constraint — CSV re-uploads skip existing addresses automatically
- Each campaign sends to the full list at time of creation via cursor-based pagination

## Retry Logic

Failed sends are tracked in `failedCount` on the campaign. To retry failed emails, create a new campaign — in a future iteration you could add a `CampaignRecipient` join table to track per-email status and retry only failures.
