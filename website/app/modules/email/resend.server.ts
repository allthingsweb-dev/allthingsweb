import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

type EmailData = {
  from: {
    name: string;
    email: string;
  }
  to: string[];
  subject: string;
  html: string;
};

export async function sendEmail({ from, to, subject, html }: EmailData) {
  const { error } = await resend.emails.send({
    from: `${from.name} <${from.email}>`,  
    to,
    subject,
    html,
  });
  if (error) {
    console.error(error);
  }
}
