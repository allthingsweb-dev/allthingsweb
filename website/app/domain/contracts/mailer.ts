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
