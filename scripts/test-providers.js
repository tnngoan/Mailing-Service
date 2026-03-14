/**
 * Test each configured provider by sending a single email.
 * Usage: node scripts/test-providers.js
 */

const SENDER_EMAIL = 'goodmorning@trada.ink';
const SENDER_NAME = 'Trà đá bàn chứng khoán';
const TEST_RECIPIENT = 'goodmorning@trada.ink'; // send to yourself

const subject = 'Provider Test — ' + new Date().toLocaleString();
const htmlBody = '<h2>Provider Test</h2><p>If you see this, the provider works!</p>';
const textBody = 'Provider Test — If you see this, the provider works!';

async function testSendGrid() {
  const apiKey = (process.env.SENDGRID_API_KEY ?? '').trim();
  if (!apiKey) return skip('sendgrid');

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: TEST_RECIPIENT }] }],
      from: { email: SENDER_EMAIL, name: SENDER_NAME },
      subject: `[SendGrid] ${subject}`,
      content: [
        { type: 'text/plain', value: textBody },
        { type: 'text/html', value: htmlBody },
      ],
    }),
  });
  return report('sendgrid', res.status, res.ok ? null : await res.text());
}

async function testBrevo() {
  const apiKey = (process.env.BREVO_API_KEY ?? '').trim();
  if (!apiKey) return skip('brevo');

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { email: SENDER_EMAIL, name: SENDER_NAME },
      to: [{ email: TEST_RECIPIENT }],
      subject: `[Brevo] ${subject}`,
      htmlContent: htmlBody,
      textContent: textBody,
    }),
  });
  const body = await res.text();
  return report('brevo', res.status, res.ok ? null : body);
}

async function testMailjet() {
  const apiKey = (process.env.MAILJET_API_KEY ?? '').trim();
  const secretKey = (process.env.MAILJET_SECRET_KEY ?? '').trim();
  if (!apiKey || !secretKey) return skip('mailjet');

  const auth = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
  const res = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Messages: [{
        From: { Email: SENDER_EMAIL, Name: SENDER_NAME },
        To: [{ Email: TEST_RECIPIENT }],
        Subject: `[Mailjet] ${subject}`,
        HTMLPart: htmlBody,
        TextPart: textBody,
      }],
    }),
  });
  const body = await res.text();
  return report('mailjet', res.status, res.ok ? null : body);
}

async function testSendPulse() {
  const clientId = (process.env.SENDPULSE_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.SENDPULSE_CLIENT_SECRET ?? '').trim();
  if (!clientId || !clientSecret) return skip('sendpulse');

  // Get OAuth token first
  const tokenRes = await fetch('https://api.sendpulse.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) return report('sendpulse', tokenRes.status, `Auth failed: ${JSON.stringify(tokenData)}`);

  const token = tokenData.access_token;
  const res = await fetch('https://api.sendpulse.com/smtp/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: {
        from: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: TEST_RECIPIENT }],
        subject: `[SendPulse] ${subject}`,
        html: htmlBody,
        text: textBody,
      },
    }),
  });
  const body = await res.text();
  return report('sendpulse', res.status, res.ok ? null : body);
}

async function testMailtrap() {
  const apiKey = (process.env.MAILTRAP_API_KEY ?? '').trim();
  if (!apiKey) return skip('mailtrap');

  const res = await fetch('https://bulk.api.mailtrap.io/api/send', {
    method: 'POST',
    headers: { 'Api-Token': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: { email: SENDER_EMAIL, name: SENDER_NAME },
      to: [{ email: TEST_RECIPIENT }],
      subject: `[Mailtrap] ${subject}`,
      html: htmlBody,
      text: textBody,
    }),
  });
  const body = await res.text();
  return report('mailtrap', res.status, res.ok ? null : body);
}

function skip(name) {
  console.log(`  ⊘  ${name.padEnd(12)} — SKIPPED (no API key)`);
}

function report(name, status, error) {
  if (!error) {
    console.log(`  ✓  ${name.padEnd(12)} — OK (HTTP ${status})`);
  } else {
    const short = typeof error === 'string' ? error.slice(0, 200) : JSON.stringify(error).slice(0, 200);
    console.log(`  ✗  ${name.padEnd(12)} — FAILED (HTTP ${status}): ${short}`);
  }
}

async function main() {
  console.log(`\nTesting all providers → sending to ${TEST_RECIPIENT}\n`);

  await testSendGrid();
  await testBrevo();
  await testMailjet();
  await testSendPulse();
  await testMailtrap();

  console.log('\nCheck your inbox for test emails from each provider.\n');
}

main().catch(console.error);
