# Bounce & Unsubscribe Check Guide

**Purpose:** Log in to each email provider, check for bounced/unsubscribed addresses, and remove them from our mailing list CSV before the next send.

**When to do this:** After each batch send (ideally daily), before uploading a new campaign.

---

## Provider Accounts

### 1. Mailjet (800 emails sent)
- **Login URL:** https://app.mailjet.com/signin
- **Account email:** ngoan.n.tr@gmail.com
- **How to check bounces:**
  1. Go to **Statistics > Email Analytics**
  2. Click the **Bounces** tab
  3. Filter by date range (last 24 hours or since last check)
  4. Export the bounced email list (CSV download button)
- **How to check unsubscribes:**
  1. Go to **Statistics > Email Analytics > Unsubscribes** tab
  2. Export the unsubscribed email list
- **How to check spam complaints:**
  1. Go to **Statistics > Email Analytics > Spam** tab
  2. Export spam complaint emails
- **API shortcut (optional):**
  ```
  curl -s -u YOUR_MAILJET_API_KEY:YOUR_MAILJET_SECRET \
    "https://api.mailjet.com/v3/REST/bounce?Limit=100" | python3 -m json.tool
  ```

---

### 2. Mailtrap (150 emails sent)
- **Login URL:** https://mailtrap.io/signin
- **Account email:** ngoan.n.tr@gmail.com (Account: Nhu Ngoan Tran)
- **How to check bounces:**
  1. Go to **Email Sending > Analytics**
  2. Look at the **Bounces** section
  3. Click into bounce details to see individual email addresses
  4. Note both **hard bounces** (permanent — remove immediately) and **soft bounces** (temporary — remove after 3 occurrences)
- **How to check unsubscribes:**
  1. Go to **Email Sending > Suppressions**
  2. Check the suppression list for unsubscribed addresses

---

### 3. SendGrid (100 emails sent)
- **Login URL:** https://app.sendgrid.com/login
- **Account email:** ngoan.n.tr@gmail.com
- **How to check bounces:**
  1. Go to **Activity > Bounce** (left sidebar under Suppressions)
  2. Or go to **Suppressions > Bounces**
  3. Export all bounced addresses
- **How to check unsubscribes:**
  1. Go to **Suppressions > Global Unsubscribes**
  2. Export unsubscribed addresses
- **How to check spam complaints:**
  1. Go to **Suppressions > Spam Reports**
  2. Export reported addresses
- **API shortcut (optional):**
  ```
  curl -s -H "Authorization: Bearer YOUR_SENDGRID_API_KEY" \
    "https://api.sendgrid.com/v3/suppression/bounces" | python3 -m json.tool
  ```

---

### 4. MailerSend (1 email sent — trial limit reached)
- **Login URL:** https://app.mailersend.com/login
- **Account email:** ngoan.n.tr@gmail.com
- **How to check bounces:**
  1. Go to **Activity** in the left sidebar
  2. Filter by **Status: Bounced**
  3. Note the bounced email addresses
- **How to check unsubscribes:**
  1. Go to **Suppressions** in the left sidebar
  2. Check **Unsubscribes** and **Hard Bounces** tabs

---

### 5. Resend (100 emails sent)
- **Login URL:** https://resend.com/login
- **Account email:** ngoan.n.tr@gmail.com
- **How to check bounces:**
  1. Go to **Emails** in the left sidebar
  2. Filter by **Status: Bounced**
  3. Note all bounced addresses
- **Note:** Resend automatically suppresses bounced addresses. Check the **Suppression list** under Settings.

---

### 6. Mailgun (pending activation — 0 emails sent)
- **Login URL:** https://app.mailgun.com/
- **Account email:** ngoan.n.tr@gmail.com
- **Domain:** mail.trada.ink
- **How to check bounces (once active):**
  1. Go to **Sending > Logs**
  2. Filter by **Event: Bounced**
  3. Export bounced addresses
- **How to check unsubscribes:**
  1. Go to **Sending > Suppressions > Unsubscribes**

---

## What to Do with Bounced/Unsubscribed Addresses

### Step 1: Collect all addresses
Create a spreadsheet with columns:
| Email | Source Provider | Type | Date |
|-------|---------------|------|------|
| example@bad.com | mailjet | hard bounce | 2026-03-15 |
| user@nope.com | sendgrid | unsubscribe | 2026-03-15 |

### Step 2: Categorize
- **Hard bounces** → Remove immediately (invalid email, domain doesn't exist)
- **Soft bounces** → Keep for now, remove if bounces 3+ times
- **Unsubscribes** → Remove immediately (legally required — CAN-SPAM / GDPR)
- **Spam complaints** → Remove immediately (critical for sender reputation)

### Step 3: Remove from mailing list
1. Open the master CSV mailing list
2. Search for and delete each bounced/unsubscribed email
3. Save the cleaned CSV
4. Use the cleaned CSV for the next campaign upload

### Step 4: Verify removal
- Count rows before and after cleaning
- Log how many addresses were removed and why
- Report back: "Removed X hard bounces, Y unsubscribes, Z spam complaints"

---

## Important Notes

- **NEVER re-add** unsubscribed or spam-complaint addresses — this violates anti-spam laws
- **Hard bounces** should be permanently removed — sending to them hurts sender reputation
- Check bounces **within 24 hours** of each send — providers may auto-suppress after a while
- If a provider shows a **high bounce rate** (>5%), pause sending and investigate the list quality
- Keep a separate "removed addresses" file for audit trail

---

## Quick Reference — Dashboard URLs

| Provider | Dashboard | Bounces Page |
|----------|-----------|-------------|
| Mailjet | app.mailjet.com | Statistics > Email Analytics > Bounces |
| Mailtrap | mailtrap.io | Email Sending > Analytics |
| SendGrid | app.sendgrid.com | Suppressions > Bounces |
| MailerSend | app.mailersend.com | Activity (filter: Bounced) |
| Resend | resend.com | Emails (filter: Bounced) |
| Mailgun | app.mailgun.com | Sending > Logs (filter: Bounced) |
