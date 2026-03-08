import sgMail from '@sendgrid/mail';

sgMail.setApiKey((process.env.SENDGRID_API_KEY ?? '').trim());

const SENDER_EMAIL = (process.env.SENDER_EMAIL ?? '').trim();
const SENDER_NAME = (process.env.SENDER_NAME ?? 'Newsletter').trim();

export function buildHtmlEmail(content: string, subject: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${subject}</title>
  <style>
    body { margin: 0; padding: 0; background: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: #18181b; padding: 24px 32px; }
    .header h1 { margin: 0; color: #ffffff; font-size: 20px; font-weight: 600; }
    .body { padding: 32px; color: #374151; font-size: 15px; line-height: 1.7; }
    .footer { background: #f9fafb; border-top: 1px solid #e5e7eb; padding: 20px 32px; text-align: center; font-size: 12px; color: #9ca3af; }
    .footer a { color: #6b7280; text-decoration: underline; }
    pre { white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>${subject}</h1>
    </div>
    <div class="body">
      <pre>${content}</pre>
    </div>
    <div class="footer">
      <p>You are receiving this email because you subscribed to our list.<br/>
      To unsubscribe, reply with "unsubscribe" in the subject line.</p>
    </div>
  </div>
</body>
</html>`;
}

export interface SendResult {
  success: boolean;
  email: string;
  error?: string;
}

export async function sendBatch(
  emails: string[],
  subject: string,
  content: string
): Promise<SendResult[]> {
  const html = buildHtmlEmail(content, subject);

  try {
    // One API call for the whole batch using personalizations.
    // Each recipient gets their own copy and cannot see other addresses.
    // SendGrid accepts up to 1000 personalizations per request.
    await sgMail.send({
      personalizations: emails.map((to) => ({ to: [{ email: to }] })),
      from: { email: SENDER_EMAIL, name: SENDER_NAME },
      subject,
      text: content,
      html,
    });

    return emails.map((email) => ({ success: true, email }));
  } catch (err: unknown) {
    // Extract the real error message from SendGrid's response body
    const sgErr = err as {
      message?: string;
      response?: { body?: { errors?: { message: string }[] } };
    };
    const detail =
      sgErr?.response?.body?.errors?.[0]?.message ??
      sgErr?.message ??
      'Unknown SendGrid error';

    console.error('[sendBatch] SendGrid rejected batch:', detail, sgErr?.response?.body);

    return emails.map((email) => ({ success: false, email, error: detail }));
  }
}
