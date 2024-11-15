import { Resend } from 'resend';
import { randomUUID } from 'node:crypto';
import { MainConfig } from '~/domain/contracts/config';
import { Logger } from '~/domain/contracts/logger';
import { Mailer } from '~/domain/contracts/mailer';

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
