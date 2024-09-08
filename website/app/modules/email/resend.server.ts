import { Resend } from 'resend';
import { randomUUID } from 'crypto';
import { env } from '../env.server';

const resend = env.resendAPIKey ? new Resend(process.env.RESEND_API_KEY) : null;

type EmailData = {
  from: {
    name: string;
    email: string;
  };
  to: string[];
  subject: string;
  html: string;
  attachments?: {
    content: Buffer;
    filename: string;
    contentType: string;
  }[];
};

export async function sendEmail({ from, to, subject, html, attachments }: EmailData) {
  if (!env.resendAPIKey || !resend) {
    console.warn('Did not send email because env.resendAPIKey is not set', { from, to, subject });
    return;
  }
  const { error } = await resend.emails.send({
    from: `${from.name} <${from.email}>`,
    to,
    subject,
    html,
    headers: {
      'X-Entity-Ref-ID': await randomUUID(),
    },
    attachments,
  });
  if (error) {
    console.error(error);
  }
}
