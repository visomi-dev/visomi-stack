import {
  SESv2Client,
  CreateEmailTemplateCommand,
  SendEmailCommand,
} from '@aws-sdk/client-sesv2';

const client = new SESv2Client({
  region: process.env['AWS_REGION'] ?? 'us-east-1',
});

export function createTemplate({
  name,
  subject,
  text,
  html,
}: {
  name: string;
  subject: string;
  text: string;
  html: string;
}) {
  const input = {
    TemplateName: name,
    TemplateContent: {
      Subject: subject,
      Text: text,
      Html: html,
    },
  };

  const command = new CreateEmailTemplateCommand(input);

  return client.send(command);
}

export async function sendTemplatedEmail({
  template,
  to,
  from,
  data,
}: {
  template: string;
  to: string;
  from: string;
  data: Record<string, string>;
}) {
  const command = new SendEmailCommand({
    Destination: {
      ToAddresses: [to],
    },
    FromEmailAddress: from,
    Content: {
      Template: {
        TemplateName: template,
        TemplateData: JSON.stringify(data),
      },
    },
  });

  return client.send(command);
}
