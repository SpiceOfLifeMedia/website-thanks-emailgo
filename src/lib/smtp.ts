import nodemailer from 'nodemailer';
import { sanitizeCustomerCopy } from '@/lib/customer-copy';

export function smtpConfigured() {
  return Boolean(process.env.EMAILGO_SMTP_HOST?.trim() && process.env.EMAILGO_SMTP_USER?.trim() && process.env.EMAILGO_SMTP_PASSWORD);
}

export type OutboundAttachment = {
  filename: string;
  content: string;
  contentType?: string;
  contentId?: string;
};

export type OutboundMessage = {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: OutboundAttachment[];
};

function createTransport() {
  if (!smtpConfigured()) throw new Error('SMTP delivery is not configured. Add EMAILGO_SMTP_HOST, EMAILGO_SMTP_USER and EMAILGO_SMTP_PASSWORD.');
  const port = Number(process.env.EMAILGO_SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('EMAILGO_SMTP_PORT must be a valid TCP port.');
  const secure = process.env.EMAILGO_SMTP_SECURE === 'true' || port === 465;
  return nodemailer.createTransport({
    host: process.env.EMAILGO_SMTP_HOST,
    port,
    secure,
    requireTLS: !secure,
    auth: { user: process.env.EMAILGO_SMTP_USER, pass: process.env.EMAILGO_SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

export async function verifySmtpConnection() {
  const transport = createTransport();
  try {
    await transport.verify();
    return true;
  } finally {
    transport.close();
  }
}

export async function sendThroughSmtp(message: OutboundMessage) {
  const transport = createTransport();
  try {
    const result = await transport.sendMail({
      from: message.from,
      to: message.to,
      ...(message.cc?.length ? { cc: message.cc } : {}),
      ...(message.bcc?.length ? { bcc: message.bcc } : {}),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      subject: message.subject,
      ...(message.text !== undefined ? { text: message.text } : {}),
      ...(message.html !== undefined ? { html: message.html } : {}),
      ...(message.headers ? { headers: message.headers } : {}),
      ...(message.attachments?.length ? { attachments: message.attachments.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        encoding: 'base64' as const,
        ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
        ...(attachment.contentId ? { cid: attachment.contentId } : {}),
      })) } : {}),
    });
    return { messageId: result.messageId, response: sanitizeCustomerCopy(result.response) };
  } catch (error) {
    if (error instanceof Error) throw new Error(sanitizeCustomerCopy(error.message), { cause: error });
    throw error;
  } finally {
    transport.close();
  }
}
