import nodemailer from 'nodemailer';

export function smtpConfigured() {
  return Boolean(process.env.EMAILGO_SMTP_HOST?.trim() && process.env.EMAILGO_SMTP_USER?.trim() && process.env.EMAILGO_SMTP_PASSWORD);
}

export async function sendThroughSmtp(message: { from: string; to: string[]; subject: string; text?: string; html?: string }) {
  if (!smtpConfigured()) throw new Error('SMTP delivery is not configured. Add EMAILGO_SMTP_HOST, EMAILGO_SMTP_USER and EMAILGO_SMTP_PASSWORD.');
  const port = Number(process.env.EMAILGO_SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('EMAILGO_SMTP_PORT must be a valid TCP port.');
  const secure = process.env.EMAILGO_SMTP_SECURE === 'true' || port === 465;
  const transport = nodemailer.createTransport({
    host: process.env.EMAILGO_SMTP_HOST,
    port,
    secure,
    requireTLS: !secure,
    auth: { user: process.env.EMAILGO_SMTP_USER, pass: process.env.EMAILGO_SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  const result = await transport.sendMail({ ...message, to: message.to });
  return { messageId: result.messageId, response: result.response };
}
