import { Resend } from 'resend';
import { randomUUID } from 'node:crypto';
import { MainConfig } from '~/config.server';
import { Logger } from './logger.server';

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

export type Mailer = (data: EmailData) => Promise<void>;

type Deps = {
  mainConfig: MainConfig;
  logger: Logger;
};
export const createMailer = ({ mainConfig, logger }: Deps): Mailer => {
  if (!mainConfig.resend.apiKey) {
    return async (emailData) => logger.warn('Faking Send email as Resend API key is not defined.', emailData);
  }

  const resend = new Resend(mainConfig.resend.apiKey);
  return async ({ from, to, subject, html, attachments }) => {
    const { error } = await resend.emails.send({
      from: `${from.name} <${from.email}>`,
      to,
      subject,
      html,
      headers: {
        'X-Entity-Ref-ID': randomUUID(),
      },
      attachments,
    });
    if (error) {
      logger.error(error);
    }
  };
};
